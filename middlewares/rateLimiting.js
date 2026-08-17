const rateLimit = require('express-rate-limit');

// Login attempt limiter
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// OTP request limiter
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 3,
  message: 'Too many OTP requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// General API limiter
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
});

// Blog creation limiter (per user)
const blogCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?._id || req.ip,
  skip: (req) => !req.user,
  message: 'You are creating blogs too quickly, please slow down',
});

// Privacy toggle limiter (per user)
const privacyToggleLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?._id || req.ip,
  skip: (req) => !req.user,
  message: 'You are toggling privacy too quickly, please slow down',
});

module.exports = {
  loginLimiter,
  otpLimiter,
  apiLimiter,
  blogCreationLimiter,
  privacyToggleLimiter
};
