// graphql/schema.js
const { buildSchema } = require("graphql");
const Blog = require("../models/Blog");
const User = require("../models/user");

const schema = buildSchema(`
  type User {
    _id: ID
    fullName: String
    email: String
    profileImageURL: String
    role: String
  }

  type Blog {
    _id: ID
    title: String
    body: String
    coverImageURL: String
    createdAt: String
    createdBy: User
    viewCount: Int
    likes: [ID]
  }

  type Query {
    blogs(search: String, sort: String, page: Int = 1, limit: Int = 9): [Blog]
    blog(id: ID!): Blog
    me: User
  }
`);

const root = {
  // Get all blogs with filtering, pagination, AND privacy filter
  blogs: async ({ search, sort = "newest", page = 1, limit = 9 }, context) => {
    try {
      const currentUserId = context.user?._id?.toString();

      // Build base filter
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

      // ====== PRIVACY FILTER: Hide private authors' blogs ======
      const privateAuthors = await User.find({ isPrivate: true, isDeleted: false }).select("_id followers").lean();

      const hiddenAuthorIds = privateAuthors
        .filter(u => !currentUserId || !(u.followers || []).some(f => f.toString() === currentUserId))
        .map(u => u._id.toString());

      if (hiddenAuthorIds.length > 0) {
        filter.createdBy = { $nin: hiddenAuthorIds };
      }
      // =========================================================

      let sortOption = { createdAt: -1 };
      if (sort === "oldest") sortOption = { createdAt: 1 };
      if (sort === "title") sortOption = { title: 1 };
      if (sort === "trending") sortOption = { viewCount: -1 };

      return await Blog.find(filter)
        .sort(sortOption)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("createdBy", "fullName profileImageURL")
        .lean();
    } catch (error) {
      console.error("GraphQL blogs error:", error);
      return [];
    }
  },

  // Get single blog by ID (with privacy check)
  blog: async ({ id }, context) => {
    try {
      const blog = await Blog.findById(id)
        .populate("createdBy", "fullName profileImageURL bio followers isPrivate")
        .lean();

      if (!blog || blog.isDeleted) return null;

      // Privacy check
      const author = blog.createdBy;
      const currentUserId = context.user?._id?.toString();
      const isSelf = currentUserId === author._id.toString();
      const isFollower = (author.followers || []).some(f => f.toString() === currentUserId);
      const isAdmin = context.user?.role === "ADMIN";

      if (author.isPrivate && !isSelf && !isFollower && !isAdmin) {
        return null; // Hide private blogs from non-followers
      }

      return blog;
    } catch (error) {
      console.error("GraphQL blog error:", error);
      return null;
    }
  },

  // Get current logged-in user
  me: (args, context) => {
    return context.user || null;
  }
};

module.exports = { schema, root };
