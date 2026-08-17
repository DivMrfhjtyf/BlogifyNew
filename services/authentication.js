const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error("❌ FATAL: JWT_SECRET environment variable is not set!");
  console.error("Set a strong random secret in your environment variables.");
  process.exit(1);
}

// Create Token
const creatTokenForUser = (user) => {
  const payload = {
    _id: user._id,
    email: user.email,
    fullName: user.fullName,
    profileImageURL: user.profileImageURL,
    role: user.role,
    googleId: user.googleId
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
};

// Verify Token
const verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};

module.exports = {
  creatTokenForUser,
  verifyToken
};
