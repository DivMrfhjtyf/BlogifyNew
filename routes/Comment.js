const express = require("express");
const router = express.Router();
const Comment = require("../models/Comment");
const Blog = require("../models/Blog");
const User = require("../models/user");
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const { validateComment } = require("../middlewares/validation");
const NotificationService = require("../services/notificationService");

router.use(restrictToLoggedInUserOnly);

// ====================== GET COMMENTS FOR BLOG ======================
router.get("/blog/:blogId", async (req, res) => {
  try {
    const { blogId } = req.params;
    const { page = 1 } = req.query;
    const limit = 10;
    const skip = (page - 1) * limit;

    // Privacy check: verify viewer can access this blog
    const blog = await Blog.findById(blogId).lean();
    if (!blog) return res.status(404).json({ success: false, message: "Blog not found" });

    const author = await User.findById(blog.createdBy).lean();
    const currentUserId = req.user._id.toString();
    const isSelf = currentUserId === author._id.toString();
    const isFollower = author.followers.some(f => f.toString() === currentUserId);
    const isAdmin = req.user.role === "ADMIN";

    if (author.isPrivate && !isSelf && !isFollower && !isAdmin) {
      return res.status(403).json({ success: false, message: "This blog is from a private account" });
    }

    const comments = await Comment.find({
      blog: blogId,
      parentComment: null,
      isDeleted: false
    })
      .populate("author", "fullName profileImageURL")
      .populate({
        path: "replies",
        populate: { path: "author", select: "fullName profileImageURL" }
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Comment.countDocuments({
      blog: blogId,
      parentComment: null,
      isDeleted: false
    });

    res.json({
      success: true,
      comments,
      total,
      pages: Math.ceil(total / limit),
      currentPage: parseInt(page)
    });
  } catch (error) {
    console.error("Error fetching comments:", error);
    res.status(500).json({ success: false, message: "Failed to fetch comments" });
  }
});

// ====================== POST COMMENT ======================
router.post("/blog/:blogId", async (req, res) => {
  try {
    const { blogId } = req.params;
    const { content, parentCommentId } = req.body;

    // Validate
    const validation = validateComment(content);
    if (!validation.isValid) {
      return res.status(400).json({ success: false, errors: validation.errors });
    }

    // Check blog exists
    const blog = await Blog.findById(blogId);
    if (!blog) {
      return res.status(404).json({ success: false, message: "Blog not found" });
    }

    // ====== PRIVACY CHECK: Only followers can comment on private author's blog ======
    const author = await User.findById(blog.createdBy).lean();
    const currentUserId = req.user._id.toString();
    const isSelf = currentUserId === author._id.toString();
    const isFollower = author.followers.some(f => f.toString() === currentUserId);
    const isAdmin = req.user.role === "ADMIN";

    if (author.isPrivate && !isSelf && !isFollower && !isAdmin) {
      return res.status(403).json({ success: false, message: "Follow this account to comment on their blogs" });
    }
    // ==============================================================================

    // Create comment
    const comment = await Comment.create({
      content: content.trim(),
      blog: blogId,
      author: req.user._id,
      parentComment: parentCommentId || null
    });

    // If reply, add to parent
    if (parentCommentId) {
      await Comment.findByIdAndUpdate(
        parentCommentId,
        { $push: { replies: comment._id } }
      );
    }

    // Populate author info
    await comment.populate("author", "fullName profileImageURL");

    // Send notification to blog author
    if (blog.createdBy.toString() !== req.user._id.toString()) {
      await NotificationService.createNotification(
        blog.createdBy,
        "comment",
        {
          title: "New comment",
          message: `${req.user.fullName} commented on your blog`,
          blog: blogId,
          actor: req.user._id
        }
      );

      // Send email
      const blogAuthor = await User.findById(blog.createdBy);
      if (blogAuthor?.notificationSettings?.emailOnComment) {
        await NotificationService.sendEmailNotification(blogAuthor, "comment", {
          blogTitle: blog.title,
          actorName: req.user.fullName,
          comment: content.substring(0, 100)
        });
      }
    }

    res.json({ success: true, comment });
  } catch (error) {
    console.error("Error posting comment:", error);
    res.status(500).json({ success: false, message: "Failed to post comment" });
  }
});

// ====================== UPDATE COMMENT ======================
router.put("/:commentId", async (req, res) => {
  try {
    const { commentId } = req.params;
    const { content } = req.body;

    const validation = validateComment(content);
    if (!validation.isValid) {
      return res.status(400).json({ success: false, errors: validation.errors });
    }

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    if (comment.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    comment.content = content.trim();
    await comment.save();

    res.json({ success: true, comment });
  } catch (error) {
    console.error("Error updating comment:", error);
    res.status(500).json({ success: false, message: "Failed to update comment" });
  }
});

// ====================== DELETE COMMENT ======================
router.delete("/:commentId", async (req, res) => {
  try {
    const { commentId } = req.params;

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    if (comment.author.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    comment.isDeleted = true;
    await comment.save();

    res.json({ success: true, message: "Comment deleted" });
  } catch (error) {
    console.error("Error deleting comment:", error);
    res.status(500).json({ success: false, message: "Failed to delete comment" });
  }
});

// ====================== LIKE COMMENT ======================
router.post("/:commentId/like", async (req, res) => {
  try {
    const { commentId } = req.params;

    const comment = await Comment.findById(commentId);
    if (!comment) {
      return res.status(404).json({ success: false, message: "Comment not found" });
    }

    // Privacy check on parent blog
    const blog = await Blog.findById(comment.blog).lean();
    if (blog) {
      const author = await User.findById(blog.createdBy).lean();
      const currentUserId = req.user._id.toString();
      const isSelf = currentUserId === author._id.toString();
      const isFollower = author.followers.some(f => f.toString() === currentUserId);
      const isAdmin = req.user.role === "ADMIN";

      if (author.isPrivate && !isSelf && !isFollower && !isAdmin) {
        return res.status(403).json({ success: false, message: "Follow this account to interact" });
      }
    }

    const hasLiked = comment.likes.some(id => id.toString() === req.user._id.toString());

    if (hasLiked) {
      comment.likes = comment.likes.filter(id => id.toString() !== req.user._id.toString());
    } else {
      comment.likes.push(req.user._id);
    }

    await comment.save();

    res.json({
      success: true,
      liked: !hasLiked,
      likeCount: comment.likes.length
    });
  } catch (error) {
    console.error("Error liking comment:", error);
    res.status(500).json({ success: false, message: "Failed to like comment" });
  }
});

module.exports = router;
