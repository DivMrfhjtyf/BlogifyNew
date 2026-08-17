const User = require("../models/user");

// Check if current user can view target user's profile/content
const canViewUserContent = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId || req.params.id;
    const targetUser = await User.findById(targetUserId).lean();

    if (!targetUser) return res.status(404).send("User not found");

    // Admin can always view
    if (req.user?.role === "ADMIN") {
      req.targetUser = targetUser;
      return next();
    }

    // Public account → anyone can view
    if (!targetUser.isPrivate) {
      req.targetUser = targetUser;
      return next();
    }

    // Private account → only followers or self can view
    const isSelf = req.user?._id.toString() === targetUserId;
    const isFollower = targetUser.followers.some(
      id => id.toString() === req.user?._id.toString()
    );

    if (isSelf || isFollower) {
      req.targetUser = targetUser;
      return next();
    }

    // Not authorized
    return res.status(403).render("private-account", {
      user: req.user,
      targetUser: {
        fullName: targetUser.fullName,
        profileImageURL: targetUser.profileImageURL,
        bio: targetUser.bio,
        followerCount: targetUser.followers.length,
        followingCount: targetUser.following.length
      }
    });
  } catch (error) {
    console.error("Privacy check error:", error);
    res.status(500).send("Internal Server Error");
  }
};

// Check if blog author is private and viewer is follower
const canViewBlog = async (req, res, next) => {
  try {
    const Blog = require("../models/Blog");
    const blog = await Blog.findById(req.params.id).lean();

    if (!blog) return res.status(404).send("Blog not found");

    const author = await User.findById(blog.createdBy).lean();

    // Public author → allow
    if (!author.isPrivate) return next();

    // Private author → check if viewer is follower or self
    const isSelf = req.user?._id.toString() === author._id.toString();
    const isFollower = author.followers.some(
      id => id.toString() === req.user?._id.toString()
    );

    if (isSelf || isFollower || req.user?.role === "ADMIN") {
      return next();
    }

    return res.status(403).send("This blog is from a private account");
  } catch (error) {
    console.error("Blog privacy check error:", error);
    res.status(500).send("Internal Server Error");
  }
};

module.exports = { canViewUserContent, canViewBlog };
