const express = require('express');
const router = express.Router();
const User = require('../models/user');
const { sendOTPEmail, sendResetPasswordEmail } = require('../services/email');
const { creatTokenForUser } = require('../services/authentication');
const crypto = require('crypto');
const { loginLimiter, otpLimiter } = require('../middlewares/rateLimiting');
const { validateEmail } = require('../middlewares/validation');

const otpStore = new Map();
const resetTokens = new Map();

const wantsJson = (req) => {
  return req.xhr ||
    req.headers['content-type']?.includes('application/json') ||
    (req.headers.accept && req.headers.accept.includes('application/json'));
};

const renderAuth = (res, view, req, error = null, extra = {}) => {
  return res.render(view, { user: req.user || null, error, ...extra });
};

router.post('/test-email', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ success: false, message: 'Email is required' });
  try {
    const testOTP = '123456';
    await sendOTPEmail(email, testOTP);
    return res.json({ success: true, message: `Test email sent to ${email}` });
  } catch (error) {
    return res.status(500).json({ success: false, message: `Email test failed: ${error.message}` });
  }
});

router.get('/signin', (req, res) => {
  if (req.user) {
    const returnTo = req.cookies.returnTo || '/';
    res.clearCookie('returnTo');
    return res.redirect(returnTo);
  }
  return renderAuth(res, 'signin', req);
});

router.post('/signin', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      const msg = 'Email and password are required';
      if (wantsJson(req)) return res.status(400).json({ success: false, message: msg });
      return renderAuth(res, 'signin', req, msg);
    }
    if (!validateEmail(email)) {
      const msg = 'Invalid email format';
      if (wantsJson(req)) return res.status(400).json({ success: false, message: msg });
      return renderAuth(res, 'signin', req, msg);
    }
    const token = await User.matchPassword(email, password);
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    const returnTo = req.cookies.returnTo || '/';
    res.clearCookie('returnTo');
    if (wantsJson(req)) return res.status(200).json({ success: true, message: 'Login successful', redirect: returnTo });
    return res.redirect(returnTo);
  } catch (error) {
    console.error('❌ Signin Error:', error.message);
    const msg = error.message || 'Invalid email or password';
    if (wantsJson(req)) return res.status(401).json({ success: false, message: msg });
    return renderAuth(res, 'signin', req, msg);
  }
});

router.get('/logout', (req, res) => {
  res.clearCookie('token');
  res.redirect('/');
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.status(200).json({ success: true, message: 'Logged out successfully' });
});

router.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/');
  return renderAuth(res, 'signup', req);
});

router.post('/send-otp', otpLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || !validateEmail(email)) return res.status(400).json({ success: false, message: 'Valid email is required' });
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail, isDeleted: false });
    if (existingUser) return res.status(409).json({ success: false, message: 'Email already registered. Please login instead.' });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(normalizedEmail, { otp, expires: Date.now() + 5 * 60 * 1000 });
    try {
      await sendOTPEmail(normalizedEmail, otp);
    } catch (emailError) {
      return res.status(500).json({ success: false, message: `Email service error: ${emailError.message}` });
    }
    res.json({ success: true, message: 'OTP sent successfully. It will expire in 5 minutes.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to send OTP.' });
  }
});

router.post('/signup', async (req, res) => {
  const { fullName, email, password, otp } = req.body;
  if (!fullName || !email || !password || !otp) {
    const msg = 'All fields are required';
    if (wantsJson(req)) return res.status(400).json({ success: false, message: msg });
    return renderAuth(res, 'signup', req, msg);
  }
  try {
    const normalizedEmail = email.toLowerCase().trim();
    if (!validateEmail(normalizedEmail)) {
      const msg = 'Invalid email format';
      if (wantsJson(req)) return res.status(400).json({ success: false, message: msg });
      return renderAuth(res, 'signup', req, msg);
    }
    if (password.length < 6) {
      const msg = 'Password must be at least 6 characters';
      if (wantsJson(req)) return res.status(400).json({ success: false, message: msg });
      return renderAuth(res, 'signup', req, msg);
    }
    const stored = otpStore.get(normalizedEmail);
    if (!stored) {
      const msg = 'No OTP found. Please request a new one.';
      if (wantsJson(req)) return res.status(400).json({ success: false, message: msg });
      return renderAuth(res, 'signup', req, msg);
    }
    if (stored.otp !== otp) {
      const msg = 'Invalid OTP';
      if (wantsJson(req)) return res.status(400).json({ success: false, message: msg });
      return renderAuth(res, 'signup', req, msg);
    }
    if (stored.expires < Date.now()) {
      otpStore.delete(normalizedEmail);
      const msg = 'OTP has expired. Please request a new one.';
      if (wantsJson(req)) return res.status(400).json({ success: false, message: msg });
      return renderAuth(res, 'signup', req, msg);
    }
    const existingUser = await User.findOne({ email: normalizedEmail, isDeleted: false });
    if (existingUser) {
      const msg = 'Email already registered. Please login instead.';
      if (wantsJson(req)) return res.status(409).json({ success: false, message: msg });
      return renderAuth(res, 'signup', req, msg);
    }
    const user = await User.create({ fullName: fullName.trim(), email: normalizedEmail, password });
    otpStore.delete(normalizedEmail);
    const token = creatTokenForUser(user);
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    if (wantsJson(req)) return res.json({ success: true, message: 'Account created successfully!', redirect: '/' });
    return res.redirect('/');
  } catch (error) {
    console.error('❌ Signup Error:', error.message);
    const msg = error.message || 'Signup failed. Please try again.';
    if (wantsJson(req)) return res.status(500).json({ success: false, message: msg });
    return renderAuth(res, 'signup', req, msg);
  }
});

router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email || !validateEmail(email)) return res.status(400).json({ success: false, message: 'Valid email is required' });
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail, isDeleted: false });
    if (!user) return res.status(200).json({ success: true, message: 'If this email exists, a reset link has been sent' });
    const resetToken = crypto.randomBytes(32).toString('hex');
    resetTokens.set(resetToken, { email: normalizedEmail, expires: Date.now() + 30 * 60 * 1000 });
    const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const resetLink = `${protocol}://${host}/user/reset-password?token=${resetToken}`;
    try {
      await sendResetPasswordEmail(normalizedEmail, resetLink);
    } catch (emailError) {
      return res.status(500).json({ success: false, message: `Email service error: ${emailError.message}` });
    }
    res.json({ success: true, message: 'If this email exists, a reset link has been sent' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to send reset link.' });
  }
});

router.get('/reset-password', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).render('404', { message: 'Invalid reset link', user: req.user || null });
  const stored = resetTokens.get(token);
  if (!stored) return res.status(400).render('404', { message: 'Reset link not found.', user: req.user || null });
  if (stored.expires < Date.now()) {
    resetTokens.delete(token);
    return res.status(400).render('404', { message: 'Reset link has expired.', user: req.user || null });
  }
  return renderAuth(res, 'reset-password', req, null, { token });
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword, confirmPassword } = req.body;
  if (!token || !newPassword || !confirmPassword) {
    const msg = 'All fields are required';
    if (wantsJson(req)) return res.status(400).json({ success: false, message: msg });
    return renderAuth(res, 'reset-password', req, msg, { token });
  }
  if (newPassword !== confirmPassword) {
    const msg = 'Passwords do not match';
    if (wantsJson(req)) return res.status(400).json({ success: false, message: msg });
    return renderAuth(res, 'reset-password', req, msg, { token });
  }
  if (newPassword.length < 6) {
    const msg = 'Password must be at least 6 characters';
    if (wantsJson(req)) return res.status(400).json({ success: false, message: msg });
    return renderAuth(res, 'reset-password', req, msg, { token });
  }
  try {
    const stored = resetTokens.get(token);
    if (!stored) {
      const msg = 'Reset link not found';
      if (wantsJson(req)) return res.status(400).json({ success: false, message: msg });
      return renderAuth(res, 'reset-password', req, msg, { token });
    }
    if (stored.expires < Date.now()) {
      resetTokens.delete(token);
      const msg = 'Reset link has expired';
      if (wantsJson(req)) return res.status(400).json({ success: false, message: msg });
      return renderAuth(res, 'reset-password', req, msg, { token });
    }
    const user = await User.findOne({ email: stored.email, isDeleted: false });
    if (!user) {
      const msg = 'User not found';
      if (wantsJson(req)) return res.status(404).json({ success: false, message: msg });
      return renderAuth(res, 'reset-password', req, msg, { token });
    }
    user.password = newPassword;
    await user.save();
    resetTokens.delete(token);
    if (wantsJson(req)) return res.json({ success: true, message: 'Password reset successfully', redirect: '/user/signin' });
    return res.redirect('/user/signin');
  } catch (error) {
    const msg = error.message || 'Failed to reset password';
    if (wantsJson(req)) return res.status(500).json({ success: false, message: msg });
    return renderAuth(res, 'reset-password', req, msg, { token });
  }
});

setInterval(() => {
  const now = Date.now();
  let otpCleaned = 0, tokenCleaned = 0;
  for (const [email, data] of otpStore.entries()) {
    if (data.expires < now) { otpStore.delete(email); otpCleaned++; }
  }
  for (const [token, data] of resetTokens.entries()) {
    if (data.expires < now) { resetTokens.delete(token); tokenCleaned++; }
  }
  if (otpCleaned > 0 || tokenCleaned > 0) console.log(`🧹 Cleanup: Removed ${otpCleaned} expired OTPs, ${tokenCleaned} expired reset tokens`);
}, 5 * 60 * 1000);

module.exports = router;
