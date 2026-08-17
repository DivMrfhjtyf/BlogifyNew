const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePassword = (password) => {
  return password.length >= 6;
};

/**
 * Sanitize input to prevent basic XSS injection.
 * Strips HTML tags, null bytes, and common attack vectors.
 * For display, EJS auto-escapes <%= %>, but this adds a defense-in-depth layer.
 */
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;

  return input
    // Remove null bytes
    .replace(/\0/g, '')
    // Remove script tags and event handlers (case insensitive)
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove on* event handlers (onclick, onerror, etc.)
    .replace(/\s*on\w+\s*=\s*["']?[^"'>]*["']?/gi, '')
    // Remove javascript: protocol
    .replace(/javascript:/gi, '')
    // Remove data: URIs that could execute code
    .replace(/data:text\/html/gi, '')
    // Remove remaining < > to break any HTML tags
    .replace(/[<>]/g, '')
    // Trim and cap length
    .trim()
    .substring(0, 5000);
};

const validateBlog = (title, body, tags = []) => {
  const errors = [];

  if (!title || title.trim().length === 0) {
    errors.push("Title is required");
  }

  if (title.length > 200) {
    errors.push("Title must be less than 200 characters");
  }

  if (!body || body.trim().length === 0) {
    errors.push("Content is required");
  }

  if (body.length > 50000) {
    errors.push("Content is too long (max 50000 characters)");
  }

  if (tags.length > 10) {
    errors.push("Maximum 10 tags allowed");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

const validateComment = (content) => {
  const errors = [];

  if (!content || content.trim().length === 0) {
    errors.push("Comment cannot be empty");
  }

  if (content.length > 5000) {
    errors.push("Comment is too long (max 5000 characters)");
  }

  return {
    isValid: errors.length === 0,
    errors
  };
};

module.exports = {
  validateEmail,
  validatePassword,
  sanitizeInput,
  validateBlog,
  validateComment
};
