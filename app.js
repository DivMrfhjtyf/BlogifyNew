const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const passport = require("passport");
const { createHandler } = require("graphql-http/lib/use/express");

// Markdown Parsing and Visual Highlighting Extensions
const { Marked } = require("marked");
const { markedHighlight } = require("marked-highlight");
const hljs = require("highlight.js");

// ====================== SUPPRESS MONGOOSE WARNINGS ======================
process.on('warning', (warning) => {
  if (warning.code === 'MONGOOSE' && warning.message.includes('Duplicate schema index')) {
    return;
  }
  console.warn(warning);
});

const UserRoute = require("./routes/User");
const GoogleAuthRoute = require("./routes/GoogleAuthentication");
const BlogRoute = require("./routes/Blog");
const AdminRoute = require("./routes/Admin");
const ProfileRoute = require("./routes/Profile");
const CommentRoute = require("./routes/Comment");
const FollowRoute = require("./routes/Follow");
const NotificationRoute = require("./routes/Notification");
const AnalyticsRoute = require("./routes/Analytics");

const { checkForAuthenticationCookie } = require("./middlewares/authentication");
const { queryHandler } = require("./middlewares/queryParams");
const { apiLimiter } = require("./middlewares/rateLimiting");
const { schema, root } = require("./graphql/schema");

const app = express();
const PORT = process.env.PORT || 8000;

require("dotenv").config();

// Security: disable X-Powered-By header
app.disable('x-powered-by');

// Trust proxy (required for req.ip behind Render's reverse proxy)
app.set('trust proxy', 1);

// Initialize Marked Parser
const marked = new Marked(
  markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    }
  })
);

// ====================== MONGODB CONNECTION ======================
mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/blogify")
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => {
    console.error("❌ MongoDB Connection Error:", err.message);
    process.exit(1);
  });

// ====================== MIDDLEWARE ======================
app.set("view engine", "ejs");
app.set("views", path.resolve("./views"));

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.resolve("./public")));

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

app.use(passport.initialize());
app.use(checkForAuthenticationCookie("token"));
app.use(queryHandler);
app.use("/api/", apiLimiter);

// ====================== GLOBAL EJS HELPERS ======================
app.locals.truncate = function(text, length = 60) {
  if (!text) return '';
  text = String(text);
  if (text.length <= length) return text;
  return text.substring(0, length).trim() + '...';
};

app.locals.formatDate = function(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
};

app.locals.renderMarkdown = function(rawContent) {
  if (!rawContent) return '';

  let contentString = String(rawContent);

  // 1. ISOLATE CODE BLOCKS
  const codeBlocks = [];
  contentString = contentString.replace(/```([\s\S]*?)```/g, (match) => {
    codeBlocks.push(match);
    return `__BLOGIFY_CODE_BLOCK_PLACEHOLDER_${codeBlocks.length - 1}__`;
  });

  // 2. CLEAN SYSTEMIC DEBRIS (string-based replaceAll, no regex)
  contentString = contentString
    .replaceAll('\\ppbr\\pp', '\n\n')
    .replaceAll('\\ppbr\\ph2', '\n\n## ')
    .replaceAll('\\ppbr\\ph', '\n\n# ')
    .replaceAll('\\pp', '\n')
    .replaceAll('\\h2pbr\\pp', '\n## ')
    .replaceAll('\\strongpbr\\ph2', '\n\n## ')
    .replaceAll('\\li\\ul', '')
    .replaceAll('\\li', '\n* ')
    .replaceAll('pbr\\pul', '\n\n')
    .replaceAll('pbr\\p', '\n')
    .replaceAll('<<\\strong>', '**')
    .replaceAll('< **', '**');

  // 3. RESTORE CODE BLOCKS
  contentString = contentString.replace(/__BLOGIFY_CODE_BLOCK_PLACEHOLDER_(\d+)__/g, (match, index) => {
    return codeBlocks[parseInt(index)];
  });

  // 4. COMPILE
  return marked.parse(contentString);
};

// ====================== GRAPHQL ENDPOINT ======================
app.all("/graphql", createHandler({
  schema: schema,
  rootValue: root,
  context: (req) => ({ user: req.user })  // FIXED: was req.raw.user
}));

// ====================== HOME ROUTE (WITH PRIVACY FILTER) ======================
app.get("/", async (req, res) => {
  try {
    const Blog = require("./models/Blog");
    const User = require("./models/user");
    const queryParams = req.queryParams || req.query || {};
    const { search = '', sort = 'newest', page = 1, limit = 9 } = queryParams;

    const filter = {
      isDeleted: false,
      status: "published"
    };

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: "i" } },
        { body: { $regex: search, $options: "i" } }
      ];
    }

    // ====== FILTER PRIVATE AUTHORS ======
    const privateAuthors = await User.find({ isPrivate: true, isDeleted: false }).select("_id followers").lean();
    const currentUserId = req.user?._id?.toString();

    const hiddenAuthorIds = privateAuthors
      .filter(u => !currentUserId || !(u.followers || []).some(f => f.toString() === currentUserId))
      .map(u => u._id.toString());

    if (hiddenAuthorIds.length > 0) {
      filter.createdBy = { $nin: hiddenAuthorIds };
    }
    // ====================================

    let sortOption = { createdAt: -1 };
    if (sort === "oldest") sortOption = { createdAt: 1 };
    if (sort === "title") sortOption = { title: 1 };
    if (sort === "trending") sortOption = { viewCount: -1 };

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [blogs, totalBlogs, featuredBlogs] = await Promise.all([
      Blog.find(filter)
        .sort(sortOption)
        .skip(skip)
        .limit(parseInt(limit))
        .populate("createdBy", "fullName profileImageURL")
        .lean(),

      Blog.countDocuments(filter),

      Blog.find({
        isFeatured: true,
        status: "published",
        isDeleted: false,
        createdBy: { $nin: hiddenAuthorIds }
      })
        .sort({ featuredRank: 1 })
        .limit(3)
        .populate("createdBy", "fullName profileImageURL")
        .lean()
    ]);

    const totalPages = Math.ceil(totalBlogs / limit);

    res.render("home", {
      title: "Blogify",
      user: req.user || null,
      blogs: blogs || [],
      featuredBlogs,
      currentPage: parseInt(page),
      totalPages,
      totalBlogs,
      search,
      sort
    });
  } catch (error) {
    console.error("🚨 Home Route Error:", error.message);
    res.status(500).send("Internal Server Error");
  }
});

// ====================== ROUTES ======================
app.use("/admin", AdminRoute);
app.use("/profile", ProfileRoute);
app.use("/user", UserRoute);
app.use("/user", GoogleAuthRoute);
app.use("/blogs", BlogRoute);
app.use("/comments", CommentRoute);
app.use("/follow", FollowRoute);
app.use("/notifications", NotificationRoute);
app.use("/analytics", AnalyticsRoute);

// ====================== 404 HANDLER ======================
app.use((req, res) => {
  res.status(404).render("404");
});

// ====================== ERROR HANDLER ======================
app.use((err, req, res, next) => {
  console.error("🚨 Server Error:", err);
  res.status(500).send("Internal Server Error");
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`🌐 Visit http://localhost:${PORT}`);
});

module.exports = app;
