const express = require('express');
const router = express.Router();
const User = require('../models/user');
const { sendOTPEmail, sendResetPasswordEmail } = require('../services/email');
const { creatTokenForUser } = require('../services/authentication');
const crypto = require('crypto');
const { loginLimiter, otpLimiter } = require('../middlewares/rateLimiting');
const { validateEmail } = require('../middlewares/validation');

// In-memory stores (for production, use Redis or database)
const otpStore = new Map();
const resetTokens = new Map();

// ====================== TEST EMAIL ENDPOINT ======================
router.post('/test-email', async (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ 
            success: false, 
            message: 'Email is required' 
        });
    }

    try {
        console.log(`\n🧪 ========== TESTING EMAIL SEND ==========`);
        console.log(`🧪 Target Email: ${email}`);
        console.log(`🧪 Sender Email: ${process.env.EMAIL_USER}`);
        
        const testOTP = '123456';
        await sendOTPEmail(email, testOTP);
        
        return res.json({ 
            success: true, 
            message: `Test email sent to ${email}. Check your inbox!` 
        });
    } catch (error) {
        console.error(`\n🧪 ========== TEST EMAIL FAILED ==========`);
        console.error(`🧪 Error: ${error.message}`);
        console.error(`🧪 Full Error:`, error);
        
        return res.status(500).json({ 
            success: false, 
            message: `Email test failed: ${error.message}`,
            error: error.message,
            code: error.code
        });
    }
});

// ====================== GET SIGNIN PAGE ======================
router.get('/signin', (req, res) => {
    if (req.user) {
        return res.redirect('/');
    }
    res.render('signin', { error: null });
});

// ====================== POST SIGNIN ======================
router.post('/signin', loginLimiter, async (req, res) => {
    const { email, password } = req.body;

    try {
        if (!email || !password) {
            return res.status(400).json({ 
                success: false, 
                message: "Email and password are required" 
            });
        }

        if (!validateEmail(email)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid email format" 
            });
        }

        const token = await User.matchPassword(email, password);
        
        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });
        
        res.status(200).json({ 
            success: true, 
            message: "Login successful",
            redirect: "/" 
        });

    } catch (error) {
        console.error("❌ Signin Error:", error.message);
        res.status(401).json({ 
            success: false, 
            message: error.message || "Invalid email or password" 
        });
    }
});

// ====================== GET LOGOUT ======================
router.get('/logout', (req, res) => {
    res.clearCookie("token");
    res.redirect('/');
});

// ====================== POST LOGOUT ======================
router.post('/logout', (req, res) => {
    res.clearCookie("token");
    res.status(200).json({ 
        success: true, 
        message: "Logged out successfully" 
    });
});

// ====================== GET SIGNUP PAGE ======================
router.get('/signup', (req, res) => {
    if (req.user) {
        return res.redirect('/');
    }
    res.render('signup', { error: null });
});

// ====================== SEND OTP ======================
router.post('/send-otp', otpLimiter, async (req, res) => {
    const { email } = req.body;

    if (!email || !validateEmail(email)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Valid email is required' 
        });
    }

    try {
        const normalizedEmail = email.toLowerCase().trim();

        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: "Email already registered. Please login instead."
            });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expires = Date.now() + 5 * 60 * 1000;

        otpStore.set(normalizedEmail, { otp, expires });

        console.log(`\n🔐 ========== OTP STORAGE ==========`);
        console.log(`🔐 Email: ${normalizedEmail}`);
        console.log(`🔐 OTP: ${otp}`);
        console.log(`🔐 Stored OTPs Count: ${otpStore.size}`);
        console.log(`🔐 ==================================\n`);

        try {
            await sendOTPEmail(normalizedEmail, otp);
        } catch (emailError) {
            console.error("\n❌ ========== OTP EMAIL ERROR ==========");
            console.error(`❌ Email: ${normalizedEmail}`);
            console.error(`❌ Error: ${emailError.message}`);
            console.error(`❌ Error Code: ${emailError.code}`);
            console.error(`❌ Error Response: ${emailError.response}`);
            console.error("❌ =====================================\n");
            
            return res.status(500).json({ 
                success: false, 
                message: `Email service error: ${emailError.message}. Error Code: ${emailError.code}` 
            });
        }

        res.json({ 
            success: true, 
            message: 'OTP sent successfully to your email. It will expire in 5 minutes.' 
        });

    } catch (error) {
        console.error("❌ Send OTP Error:", error.message);
        res.status(500).json({ 
            success: false, 
            message: error.message || 'Failed to send OTP. Please try again.' 
        });
    }
});

// ====================== POST SIGNUP ======================
router.post('/signup', async (req, res) => {
    const { fullName, email, password, otp } = req.body;

    if (!fullName || !email || !password || !otp) {
        return res.status(400).json({ 
            success: false, 
            message: "All fields are required" 
        });
    }

    try {
        const normalizedEmail = email.toLowerCase().trim();

        if (!validateEmail(normalizedEmail)) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid email format" 
            });
        }

        if (password.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: "Password must be at least 6 characters" 
            });
        }

        const stored = otpStore.get(normalizedEmail);
        
        console.log(`\n🔐 ========== OTP VERIFICATION ==========`);
        console.log(`🔐 Email: ${normalizedEmail}`);
        console.log(`🔐 Provided OTP: ${otp}`);
        console.log(`🔐 Stored OTP: ${stored ? stored.otp : 'NOT FOUND'}`);
        console.log(`🔐 ==================================\n`);
        
        if (!stored) {
            return res.status(400).json({ 
                success: false, 
                message: "No OTP found. Please request a new one." 
            });
        }

        if (stored.otp !== otp) {
            return res.status(400).json({ 
                success: false, 
                message: "Invalid OTP" 
            });
        }

        if (stored.expires < Date.now()) {
            otpStore.delete(normalizedEmail);
            return res.status(400).json({ 
                success: false, 
                message: "OTP has expired. Please request a new one." 
            });
        }

        const existingUser = await User.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(409).json({ 
                success: false, 
                message: "Email already registered. Please login instead." 
            });
        }

        const user = await User.create({
            fullName: fullName.trim(),
            email: normalizedEmail,
            password
        });

        otpStore.delete(normalizedEmail);

        const token = creatTokenForUser(user);

        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "strict",
            maxAge: 7 * 24 * 60 * 60 * 1000
        });

        res.json({ 
            success: true, 
            message: "Account created successfully!",
            redirect: "/" 
        });

    } catch (error) {
        console.error("❌ Signup Error:", error.message);
        res.status(500).json({ 
            success: false, 
            message: error.message || "Signup failed. Please try again." 
        });
    }
});

// ====================== POST FORGOT PASSWORD ======================
router.post('/forgot-password', async (req, res) => {
    const { email } = req.body;

    if (!email || !validateEmail(email)) {
        return res.status(400).json({ 
            success: false, 
            message: "Valid email is required" 
        });
    }

    try {
        const normalizedEmail = email.toLowerCase().trim();
        const user = await User.findOne({ email: normalizedEmail });

        if (!user) {
            return res.status(200).json({ 
                success: true, 
                message: "If this email exists, a password reset link has been sent" 
            });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpires = Date.now() + 30 * 60 * 1000;

        resetTokens.set(resetToken, { 
            email: normalizedEmail, 
            expires: tokenExpires 
        });

        // FIX: Build reset link using request origin (works on Vercel & local)
        const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        const baseUrl = `${protocol}://${host}`;
        const resetLink = `${baseUrl}/user/reset-password?token=${resetToken}`;
        
        console.log(`🔗 Generated reset link: ${resetLink}`);

        try {
            await sendResetPasswordEmail(normalizedEmail, resetLink);
        } catch (emailError) {
            console.error("❌ Reset email failed:", emailError.message);
            return res.status(500).json({ 
                success: false, 
                message: `Email service error: ${emailError.message}` 
            });
        }

        res.json({ 
            success: true, 
            message: "If this email exists, a password reset link has been sent" 
        });

    } catch (error) {
        console.error("❌ Forgot Password Error:", error.message);
        res.status(500).json({ 
            success: false, 
            message: error.message || "Failed to send reset link. Please try again." 
        });
    }
});

// ====================== GET RESET PASSWORD PAGE ======================
router.get('/reset-password', (req, res) => {
    const { token } = req.query;
    
    if (!token) {
        return res.status(400).render('404', { message: 'Invalid reset link' });
    }

    const stored = resetTokens.get(token);
    if (!stored) {
        return res.status(400).render('404', { 
            message: 'Reset link not found. Please request a new one.' 
        });
    }

    if (stored.expires < Date.now()) {
        resetTokens.delete(token);
        return res.status(400).render('404', { 
            message: 'Reset link has expired. Please request a new one.' 
        });
    }

    res.render('reset-password', { token, error: null });
});

// ====================== POST RESET PASSWORD ======================
router.post('/reset-password', async (req, res) => {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token || !newPassword || !confirmPassword) {
        return res.status(400).json({ 
            success: false, 
            message: "All fields are required" 
        });
    }

    if (newPassword !== confirmPassword) {
        return res.status(400).json({ 
            success: false, 
            message: "Passwords do not match" 
        });
    }

    if (newPassword.length < 6) {
        return res.status(400).json({ 
            success: false, 
            message: "Password must be at least 6 characters" 
        });
    }

    try {
        const stored = resetTokens.get(token);

        if (!stored) {
            return res.status(400).json({ 
                success: false, 
                message: "Reset link not found" 
            });
        }

        if (stored.expires < Date.now()) {
            resetTokens.delete(token);
            return res.status(400).json({ 
                success: false, 
                message: "Reset link has expired" 
            });
        }

        const user = await User.findOne({ email: stored.email });
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: "User not found" 
            });
        }

        user.password = newPassword;
        await user.save();

        resetTokens.delete(token);

        console.log(`🔐 Password reset successful for ${stored.email}`);

        res.json({ 
            success: true, 
            message: "Password reset successfully. Redirecting to login...",
            redirect: "/user/signin"
        });

    } catch (error) {
        console.error("❌ Reset Password Error:", error.message);
        res.status(500).json({ 
            success: false, 
            message: error.message || "Failed to reset password" 
        });
    }
});

// ====================== CLEANUP OLD OTP & TOKENS ======================
setInterval(() => {
    const now = Date.now();
    let otpCleaned = 0, tokenCleaned = 0;

    for (const [email, data] of otpStore.entries()) {
        if (data.expires < now) {
            otpStore.delete(email);
            otpCleaned++;
        }
    }

    for (const [token, data] of resetTokens.entries()) {
        if (data.expires < now) {
            resetTokens.delete(token);
            tokenCleaned++;
        }
    }

    if (otpCleaned > 0 || tokenCleaned > 0) {
        console.log(`🧹 Cleanup: Removed ${otpCleaned} expired OTPs, ${tokenCleaned} expired reset tokens`);
    }
}, 5 * 60 * 1000);

module.exports = router;
