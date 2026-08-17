const express = require("express");
const router = express.Router();
const User = require("../models/user");
const Blog = require("../models/Blog");

const { restrictTo } = require("../middlewares/authentication");

// Only ADMIN can access
router.use(restrictTo(["ADMIN"]));

// GET - All Users + Their Blogs
router.get("/users", async (req, res) => {
  try {
    const users = await User.find({ isDeleted: false })
      .select("fullName email profileImageURL role createdAt googleId isPrivate followers following")
      .sort({ createdAt: -1 })
      .lean();

    const usersWithBlogs = await Promise.all(users.map(async (user) => {
      const blogs = await Blog.find({ createdBy: user._id, isDeleted: false })
        .select("title coverImageURL createdAt status")
        .sort({ createdAt: -1 })
        .lean();

      return {
        ...user,
        blogCount: blogs.length,
        blogs: blogs
      };
    }));

    res.render("admin/users", {
      user: req.user,
      users: usersWithBlogs
    });
  } catch (error) {
    console.error("Admin Users Error:", error);
    res.status(500).send("Server Error");
  }
});

// DELETE - Soft Delete User (and their blogs)
router.delete("/users/:id", async (req, res) => {
  try {
    const userId = req.params.id;

    // Prevent self-deletion
    if (userId === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete yourself"
      });
    }

    // Soft delete all blogs of this user
    await Blog.updateMany(
      { createdBy: userId },
      { isDeleted: true, deletedAt: new Date() }
    );

    // Soft delete user
    await User.findByIdAndUpdate(userId, {
      isDeleted: true,
      deletedAt: new Date()
    });

    res.json({
      success: true,
      message: "User and all their blogs soft-deleted successfully"
    });
  } catch (error) {
    console.error("Admin delete error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete user"
    });
  }
});

module.exports = router;
