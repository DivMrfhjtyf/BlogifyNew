const express = require("express");
const router = express.Router();
const Blog = require("../models/Blog");
const User = require("../models/user");
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const { blogCreationLimiter } = require("../middlewares/rateLimiting");
const cloudinaryUpload = require("../middlewares/CloudinaryUploads");
const { validateBlog, sanitizeInput } = require("../middlewares/validation");
const AnalyticsService = require("../services/analyticsService");
const NotificationService = require("../services/notificationService");

// Protect all routes
router.use(restrictToLoggedInUserOnly);

// ====================== GET - Add New Blog Form ======================
router.get("/add-new", (req, res) => {
  res.render("addBlog", { user: req.user, error: null });
});

// ====================== POST - Create Blog ======================
router.post("/add-new", blogCreationLimiter, cloudinaryUpload.single("coverImage"), async (req, res) => {
  try {
    const { title, body, tags, category, status, metaDescription, excerpt } = req.body;

    const validation = validateBlog(title, body, tags ? tags.split(",") : []);
    if (!validation.isValid) {
      return res.render("addBlog", {
        user: req.user,
        error: validation.errors.join(", ")
      });
    }

    const tagsArray = tags ? tags.split(",").map(t => t.trim()).filter(t => t) : [];

    const newBlog = await Blog.create({
      title: sanitizeInput(title),
      body: sanitizeInput(body),
      coverImageURL: req.file ? req.file.path : null,
      tags: tagsArray,
      category: category || "General",
      status: status || "published",
      metaDescription: sanitizeInput(metaDescription),
      excerpt: sanitizeInput(excerpt),
      createdBy: req.user._id
    });

    await require("../models/BlogAnalytics").create({
      blog: newBlog._id,
      author: req.user._id
    });

    if (newBlog.status === "published") {
      try {
        await NotificationService.createBlogPostNotifications(
          req.user._id,
          newBlog._id,
          newBlog.title
        );
      } catch (notifError) {
        console.error("Blog post notification error (non-critical):", notifError);
      }
    }

    res.redirect(`/blogs/${newBlog._id}`);
  } catch (error) {
    console.error("Blog Creation Error:", error);
    res.render("addBlog", {
      user: req.user,
      error: "Something went wrong while creating the blog."
    });
  }
});

// ====================== GET - Edit Blog Form ======================
router.get("/:id/edit", async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id)
      .notDeleted()
      .lean();

    if (!blog) return res.status(404).send("Blog not found");

    if (blog.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).send("You are not authorized to edit this blog");
    }

    res.render("editBlog", { user: req.user, blog, error: null });
  } catch (error) {
    console.error("Edit Blog Page Error:", error);
    res.status(500).send("Internal Server Error");
  }
});

// ====================== GET - Single Blog (WITH PRIVACY CHECK) ======================
router.get("/:id", async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id)
      .notDeleted()
      .populate("createdBy", "fullName profileImageURL bio followers isPrivate")
      .lean();

    if (!blog) return res.status(404).send("Blog not found");

    // ====== PRIVACY CHECK (use populated author, no extra query) ======
    const author = blog.createdBy;
    const currentUserId = req.user?._id?.toString();
    const isSelf = currentUserId === author._id.toString();
    const isFollower = (author.followers || []).some(
      f => f.toString() === currentUserId
    );
    const isAdmin = req.user?.role === "ADMIN";

    if (author.isPrivate && !isSelf && !isFollower && !isAdmin) {
      return res.status(403).render("private-blog", {
        user: req.user,
        author: {
          fullName: author.fullName,
          profileImageURL: author.profileImageURL,
          bio: author.bio,
          _id: author._id
        }
      });
    }
    // ===========================

    // Track unique view (24-hour deduplication window)
    const viewerId = req.user ? req.user._id.toString() : req.ip;
    const userAgent = req.headers["user-agent"] || "";
    const viewerFingerprint = req.user
      ? viewerId
      : `${viewerId}_${Buffer.from(userAgent).toString("base64").substring(0, 16)}`;

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const existingView = await Blog.findOne({
      _id: blog._id,
      viewers: {
        $elemMatch: {
          viewerId: viewerFingerprint,
          viewedAt: { $gte: twentyFourHoursAgo }
        }
      }
    });

    if (!existingView) {
      await Blog.findByIdAndUpdate(blog._id, {
        $pull: { viewers: { viewerId: viewerFingerprint } }
      });

      await Blog.findByIdAndUpdate(blog._id, {
        $push: {
          viewers: {
            viewerId: viewerFingerprint,
            viewedAt: new Date(),
            isAuthenticated: !!req.user
          }
        },
        $inc: { viewCount: 1 }
      });

      await AnalyticsService.trackView(blog._id, req.user?._id, "direct");
    }

    const updatedBlog = await Blog.findById(req.params.id)
      .notDeleted()
      .populate("createdBy", "fullName profileImageURL bio followers isPrivate")
      .lean();

    const relatedBlogs = await Blog.find({
      tags: { $in: blog.tags },
      _id: { $ne: blog._id },
      isDeleted: false,
      status: "published"
    }).limit(3).lean();

    const authorBlogs = await Blog.find({
      createdBy: blog.createdBy._id,
      _id: { $ne: blog._id },
      isDeleted: false,
      status: "published"
    }).limit(3).lean();

    const hasLiked = req.user
      ? updatedBlog.likes.some(id => id.toString() === req.user._id.toString())
      : false;

    res.render("view", {
      user: req.user,
      blog: updatedBlog,
      relatedBlogs,
      authorBlogs,
      hasLiked
    });
  } catch (error) {
    console.error("Single Blog Error:", error);
    res.status(500).send("Internal Server Error");
  }
});

// ====================== PUT - Update Blog ======================
router.put("/:id", cloudinaryUpload.single("coverImage"), async (req, res) => {
  try {
    const { title, body, tags, category, status, metaDescription, excerpt } = req.body;

    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ success: false, message: "Blog not found" });

    if (blog.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    const validation = validateBlog(title, body, tags ? tags.split(",") : []);
    if (!validation.isValid) {
      return res.status(400).json({ success: false, errors: validation.errors });
    }

    blog.title = sanitizeInput(title);
    blog.body = sanitizeInput(body);
    blog.tags = tags ? tags.split(",").map(t => t.trim()).filter(t => t) : [];
    blog.category = category || "General";
    blog.status = status || "published";
    blog.metaDescription = sanitizeInput(metaDescription);
    blog.excerpt = sanitizeInput(excerpt);
    if (req.file) blog.coverImageURL = req.file.path;

    await blog.save();
    res.json({ success: true, blog });
  } catch (error) {
    console.error("Update Blog Error:", error);
    res.status(500).json({ success: false, message: "Failed to update blog" });
  }
});

// ====================== DELETE Blog ======================
router.delete("/:id", async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ success: false, message: "Blog not found" });

    if (blog.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Not authorized" });
    }

    blog.isDeleted = true;
    blog.deletedAt = new Date();
    await blog.save();

    res.json({ success: true, message: "Blog deleted successfully" });
  } catch (error) {
    console.error("Delete Blog Error:", error);
    res.status(500).json({ success: false, message: "Failed to delete blog" });
  }
});

// ====================== LIKE BLOG ======================
router.post("/:id/like", async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ success: false, message: "Blog not found" });

    // ====== PRIVACY CHECK ======
    const author = await User.findById(blog.createdBy).lean();
    const currentUserId = req.user._id.toString();
    const isSelf = currentUserId === blog.createdBy.toString();
    const isFollower = (author.followers || []).some(f => f.toString() === currentUserId);
    const isAdmin = req.user.role === "ADMIN";

    if (author.isPrivate && !isSelf && !isFollower && !isAdmin) {
      return res.status(403).json({ success: false, message: "Follow this account to like their blogs" });
    }
    // =========================================================================

    const hasLiked = blog.likes.some(id => id.toString() === req.user._id.toString());

    if (hasLiked) {
      blog.likes = blog.likes.filter(id => id.toString() !== req.user._id.toString());
    } else {
      blog.likes.push(req.user._id);

      if (blog.createdBy.toString() !== req.user._id.toString()) {
        await NotificationService.createNotification(
          blog.createdBy,
          "like",
          {
            title: "New like",
            message: `${req.user.fullName} liked your blog`,
            blog: blog._id,
            actor: req.user._id
          }
        );
      }
    }

    await blog.save();
    res.json({ success: true, liked: !hasLiked, likeCount: blog.likes.length });
  } catch (error) {
    console.error("Like Blog Error:", error);
    res.status(500).json({ success: false, message: "Failed to like blog" });
  }
});

// ====================== GET FEATURED BLOGS ======================
router.get("/featured/list", async (req, res) => {
  try {
    const privateAuthors = await User.find({ isPrivate: true }).select("_id").lean();
    const privateAuthorIds = privateAuthors.map(u => u._id.toString());

    const blogs = await Blog.find({
      isFeatured: true,
      status: "published",
      isDeleted: false,
      createdBy: { $nin: privateAuthorIds }
    })
      .sort({ featuredRank: 1, createdAt: -1 })
      .populate("createdBy", "fullName profileImageURL")
      .lean();

    res.json({ success: true, blogs });
  } catch (error) {
    console.error("Error fetching featured blogs:", error);
    res.status(500).json({ success: false, message: "Failed to fetch featured blogs" });
  }
});

// ====================== SEARCH BY TAG ======================
router.get("/tags/:tag", async (req, res) => {
  try {
    const { tag } = req.params;
    const { page = 1 } = req.query;
    const limit = 9;
    const skip = (page - 1) * limit;

    const privateAuthors = await User.find({ isPrivate: true }).select("_id").lean();
    const privateAuthorIds = privateAuthors.map(u => u._id.toString());

    const blogs = await Blog.find({
      tags: tag,
      status: "published",
      isDeleted: false,
      createdBy: { $nin: privateAuthorIds }
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("createdBy", "fullName profileImageURL")
      .lean();

    const total = await Blog.countDocuments({
      tags: tag,
      status: "published",
      isDeleted: false,
      createdBy: { $nin: privateAuthorIds }
    });

    res.render("taggedBlogs", {
      user: req.user,
      blogs,
      tag,
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });
  } catch (error) {
    console.error("Error fetching tagged blogs:", error);
    res.status(500).send("Internal Server Error");
  }
});

module.exports = router;
