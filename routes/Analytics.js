const express = require("express");
const router = express.Router();
const { restrictToLoggedInUserOnly, restrictTo } = require("../middlewares/authentication");
const AnalyticsService = require("../services/analyticsService");
const User = require("../models/user");

// ====================== GET TRENDING BLOGS ======================
router.get("/trending", async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 5, 50);

    // Get trending from analytics service
    const trendingBlogs = await AnalyticsService.getTrendingBlogs(parsedLimit);

    // Filter out private authors
    const privateAuthors = await User.find({ isPrivate: true }).select("_id").lean();
    const privateIds = privateAuthors.map(u => u._id.toString());

    const filtered = trendingBlogs.filter(item => {
      if (!item.blog || !item.blog.createdBy) return false;
      const authorId = typeof item.blog.createdBy === "object"
        ? item.blog.createdBy._id?.toString()
        : item.blog.createdBy.toString();
      return !privateIds.includes(authorId);
    });

    res.json({ success: true, blogs: filtered });
  } catch (error) {
    console.error("Error fetching trending blogs:", error);
    res.status(500).json({ success: false, message: "Failed to fetch trending blogs" });
  }
});

// ====================== GET MOST LIKED BLOGS ======================
router.get("/most-liked", async (req, res) => {
  try {
    const { limit = 5 } = req.query;
    const parsedLimit = Math.min(parseInt(limit) || 5, 50);

    const blogs = await AnalyticsService.getMostLikedBlogs(parsedLimit);

    // Filter out private authors
    const privateAuthors = await User.find({ isPrivate: true }).select("_id").lean();
    const privateIds = privateAuthors.map(u => u._id.toString());

    const filtered = blogs.filter(item => {
      if (!item.blog || !item.blog.createdBy) return false;
      const authorId = typeof item.blog.createdBy === "object"
        ? item.blog.createdBy._id?.toString()
        : item.blog.createdBy.toString();
      return !privateIds.includes(authorId);
    });

    res.json({ success: true, blogs: filtered });
  } catch (error) {
    console.error("Error fetching most liked blogs:", error);
    res.status(500).json({ success: false, message: "Failed to fetch most liked blogs" });
  }
});

// ====================== GET BLOG ANALYTICS (Protected) ======================
router.get("/blog/:blogId", restrictToLoggedInUserOnly, async (req, res) => {
  try {
    const { blogId } = req.params;
    const analytics = await AnalyticsService.getBlogAnalytics(blogId);

    if (!analytics) {
      return res.status(404).json({ success: false, message: "No analytics found" });
    }

    res.json({ success: true, analytics });
  } catch (error) {
    console.error("Error fetching blog analytics:", error);
    res.status(500).json({ success: false, message: "Failed to fetch blog analytics" });
  }
});

// ====================== GET AUTHOR ANALYTICS (Protected) ======================
router.get("/author/stats", restrictToLoggedInUserOnly, async (req, res) => {
  try {
    const stats = await AnalyticsService.getAuthorAnalytics(req.user._id);
    res.json({ success: true, stats });
  } catch (error) {
    console.error("Error fetching author analytics:", error);
    res.status(500).json({ success: false, message: "Failed to fetch author analytics" });
  }
});

module.exports = router;
