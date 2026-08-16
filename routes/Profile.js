const express = require("express");
const router = express.Router();
const { createHmac } = require("crypto");
const crypto = require("crypto");
const Blog = require("../models/Blog");
const User = require("../models/user");
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const cloudinaryUpload = require("../middlewares/CloudinaryUploads");
const { sendOTPEmail } = require("../services/email");

router.use(restrictToLoggedInUserOnly);

// In-memory OTP store for password change (use Redis in production)
const passwordOtpStore = new Map();

// ====================== GET SETTINGS PAGE ======================
router.get("/settings", async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate("followers", "fullName profileImageURL bio")
            .populate("following", "fullName profileImageURL bio");
        
        if (!user) return res.status(404).send("User not found");
        
        res.render("settings", { user });
    } catch (error) {
        console.error("Settings Route Error:", error.message);
        res.status(500).send("Internal Server Error");
    }
});

// ====================== VIEW PROFILE ======================
router.get("/", async (req, res) => {
    try {
        const fullUser = await User.findById(req.user._id)
            .populate("followers", "fullName email profileImageURL bio")
            .populate("following", "fullName email profileImageURL bio");

        if (!fullUser) return res.status(404).send("User not found");

        const blogs = await Blog.find({ createdBy: req.user._id, isDeleted: false })
            .sort({ createdAt: -1 });

        res.render("profile", {
            user: fullUser,
            blogs: blogs || []
        });
    } catch (error) {
        console.error("Profile Route Error:", error.message);
        res.status(500).send("Internal Server Error");
    }
});

// ====================== GET EDIT PROFILE PAGE (legacy) ======================
router.get("/edit", async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
            .populate("followers", "fullName profileImageURL")
            .populate("following", "fullName profileImageURL");

        res.render("editProfile", {
            user: user,
            success: null,
            error: null
        });
    } catch (error) {
        console.error("Edit Profile Page Error:", error);
        res.status(500).render("error", { error: error.message });
    }
});

// ====================== UPDATE PROFILE ======================
router.put("/update", async (req, res) => {
    try {
        const { fullName, bio, website, location, theme, notificationSettings } = req.body;

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        if (fullName !== undefined) user.fullName = fullName.trim();
        if (bio !== undefined) user.bio = bio;
        if (website !== undefined) user.website = website;
        if (location !== undefined) user.location = location;
        if (theme !== undefined) user.theme = theme;
        
        if (notificationSettings && typeof notificationSettings === 'object') {
            user.notificationSettings = {
                ...user.notificationSettings,
                ...notificationSettings
            };
        }

        await user.save();

        res.json({
            success: true,
            message: "Profile updated successfully",
            user: user
        });
    } catch (error) {
        console.error("Update Profile Error:", error);
        res.status(500).json({ success: false, message: error.message || "Failed to update profile" });
    }
});

// ====================== UPLOAD PROFILE IMAGE ======================
router.post("/upload-image", cloudinaryUpload.single("profileImage"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "No image uploaded" });
        }

        const user = await User.findById(req.user._id);
        user.profileImageURL = req.file.path;
        await user.save();

        res.json({
            success: true,
            message: "Profile image updated",
            imageURL: req.file.path
        });
    } catch (error) {
        console.error("Upload Image Error:", error);
        res.status(500).json({ success: false, message: "Failed to upload image" });
    }
});

// ====================== VERIFY CURRENT PASSWORD ======================
router.post("/verify-password", async (req, res) => {
    try {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ success: false, message: "Password is required" });
        }

        const user = await User.findById(req.user._id);
        if (user.googleId && !user.password) {
            return res.status(400).json({ success: false, message: "This account uses Google Sign-In" });
        }

        const hash = createHmac("sha256", user.salt).update(password).digest("hex");
        if (user.password !== hash) {
            return res.status(401).json({ success: false, message: "Incorrect password" });
        }

        res.json({ success: true, message: "Password verified" });
    } catch (error) {
        console.error("Verify Password Error:", error);
        res.status(500).json({ success: false, message: "Verification failed" });
    }
});

// ====================== SEND OTP FOR PASSWORD CHANGE ======================
router.post("/send-otp", async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const tempToken = crypto.randomBytes(32).toString('hex');

        passwordOtpStore.set(tempToken, {
            otp,
            userId: user._id.toString(),
            expires: Date.now() + 10 * 60 * 1000 // 10 minutes
        });

        await sendOTPEmail(user.email, otp);

        res.json({ success: true, message: "OTP sent to your email", tempToken });
    } catch (error) {
        console.error("Send OTP Error:", error);
        res.status(500).json({ success: false, message: "Failed to send OTP" });
    }
});

// ====================== VERIFY OTP ======================
router.post("/verify-otp", async (req, res) => {
    try {
        const { otp, tempToken } = req.body;
        const data = passwordOtpStore.get(tempToken);

        if (!data || data.expires < Date.now()) {
            return res.status(400).json({ success: false, message: "OTP expired. Please request a new one." });
        }
        if (data.otp !== otp) {
            return res.status(400).json({ success: false, message: "Invalid OTP" });
        }

        res.json({ success: true, message: "OTP verified" });
    } catch (error) {
        console.error("Verify OTP Error:", error);
        res.status(500).json({ success: false, message: "Verification failed" });
    }
});

// ====================== RESET PASSWORD (after OTP or current password) ======================
router.post("/reset-password", async (req, res) => {
    try {
        const { newPassword, tempToken, method } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({ success: false, message: "Password must be at least 6 characters" });
        }

        const user = await User.findById(req.user._id);

        if (method === 'otp') {
            const data = passwordOtpStore.get(tempToken);
            if (!data || data.userId !== user._id.toString()) {
                return res.status(400).json({ success: false, message: "Invalid or expired session" });
            }
            passwordOtpStore.delete(tempToken);
        }

        user.password = newPassword;
        await user.save();

        res.json({ success: true, message: "Password updated successfully" });
    } catch (error) {
        console.error("Reset Password Error:", error);
        res.status(500).json({ success: false, message: "Failed to update password" });
    }
});

// ====================== CHANGE PASSWORD (legacy direct method) ======================
router.post("/change-password", async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ success: false, message: "Current and new passwords are required" });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
        }

        const user = await User.findById(req.user._id);

        if (user.googleId && !user.password) {
            return res.status(400).json({ success: false, message: "This account uses Google Sign-In. Cannot change password." });
        }

        const currentHash = createHmac("sha256", user.salt).update(currentPassword).digest("hex");
        if (user.password !== currentHash) {
            return res.status(401).json({ success: false, message: "Current password is incorrect" });
        }

        user.password = newPassword;
        await user.save();

        res.json({ success: true, message: "Password changed successfully" });
    } catch (error) {
        console.error("Change Password Error:", error);
        res.status(500).json({ success: false, message: "Failed to change password" });
    }
});

// ====================== DELETE ACCOUNT (with password verification) ======================
router.delete("/delete-account", async (req, res) => {
    try {
        const { password } = req.body;
        const userId = req.user._id;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Verify password (skip for Google-only accounts if needed, but require password if exists)
        if (user.password) {
            if (!password) {
                return res.status(400).json({ success: false, message: "Password is required to delete account" });
            }
            const hash = createHmac("sha256", user.salt).update(password).digest("hex");
            if (user.password !== hash) {
                return res.status(401).json({ success: false, message: "Incorrect password" });
            }
        }

        // Remove user from others' followers/following
        await User.updateMany(
            { $or: [{ followers: userId }, { following: userId }] },
            { $pull: { followers: userId, following: userId } }
        );

        // Delete user's blogs
        await Blog.deleteMany({ createdBy: userId });

        // Delete user
        await User.findByIdAndDelete(userId);

        // Clear auth cookie
        res.clearCookie("token");

        res.json({ success: true, message: "Account deleted successfully" });
    } catch (error) {
        console.error("Delete Account Error:", error);
        res.status(500).json({ success: false, message: "Failed to delete account" });
    }
});

// ====================== CLEANUP EXPIRED PASSWORD OTPS ======================
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    for (const [token, data] of passwordOtpStore.entries()) {
        if (data.expires < now) {
            passwordOtpStore.delete(token);
            cleaned++;
        }
    }
    if (cleaned > 0) console.log(`🧹 Cleaned ${cleaned} expired password OTPs`);
}, 5 * 60 * 1000);

module.exports = router;
