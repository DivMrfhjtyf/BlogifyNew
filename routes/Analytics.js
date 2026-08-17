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

    let trendingBlogs = [];
    if (AnalyticsService.getTrendingBlogs) {
      trendingBlogs = await AnalyticsService.getTrendingBlogs(parsedLimit);
    } else {
      // Fallback: sort by viewCount
      const Blog = require("../models/Blog");
      trendingBlogs = await Blog.find({ isDeleted: false, status: "published" })
        .sort({ viewCount: -1 })
        .limit(parsedLimit)
        .populate("createdBy", "fullName profileImageURL")
        .lean();
      trendingBlogs = trendingBlogs.map(b => ({ blog: b, views: b.viewCount }));
    }

    // Filter out private authors
    const privateAuthors = await User.find({ isPrivate: true, isDeleted: false }).select("_id").lean();
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

    let blogs = [];
    if (AnalyticsService.getMostLikedBlogs) {
      blogs = await AnalyticsService.getMostLikedBlogs(parsedLimit);
    } else {
      // Fallback: sort by likes length
      const Blog = require("../models/Blog");
      const allBlogs = await Blog.find({ isDeleted: false, status: "published" })
        .populate("createdBy", "fullName profileImageURL")
        .lean();
      blogs = allBlogs
        .map(b => ({ blog: b, likes: b.likes.length }))
        .sort((a, b) => b.likes - a.likes)
        .slice(0, parsedLimit);
    }

    // Filter out private authors
    const privateAuthors = await User.find({ isPrivate: true, isDeleted: false }).select("_id").lean();
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
    let analytics;

    if (AnalyticsService.getBlogAnalytics) {
      analytics = await AnalyticsService.getBlogAnalytics(blogId);
    } else {
      const BlogAnalytics = require("../models/BlogAnalytics");
      analytics = await BlogAnalytics.findOne({ blog: blogId }).lean();
    }

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
    let stats;
    if (AnalyticsService.getAuthorAnalytics) {
      stats = await AnalyticsService.getAuthorAnalytics(req.user._id);
    } else {
      const Blog = require("../models/Blog");
      const BlogAnalytics = require("../models/BlogAnalytics");
      const [blogs, analytics] = await Promise.all([
        Blog.find({ createdBy: req.user._id, isDeleted: false }).lean(),
        BlogAnalytics.find({ author: req.user._id }).lean()
      ]);
      stats = {
        totalBlogs: blogs.length,
        totalViews: analytics.reduce((sum, a) => sum + (a.totalViews || 0), 0),
        totalLikes: analytics.reduce((sum, a) => sum + (a.totalLikes || 0), 0),
        totalComments: analytics.reduce((sum, a) => sum + (a.totalComments || 0), 0)
      };
    }
    res.json({ success: true, stats });
  } catch (error) {
    console.error("Error fetching author analytics:", error);
    res.status(500).json({ success: false, message: "Failed to fetch author analytics" });
  }
});

module.exports = router;
