const express = require("express");
const router = express.Router();
const User = require("../models/user");
const Blog = require("../models/Blog");
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const cloudinaryUpload = require("../middlewares/CloudinaryUploads");

// ====================== GET OWN PROFILE DASHBOARD ======================
router.get("/", restrictToLoggedInUserOnly, async (req, res) => {
  res.redirect(`/profile/${req.user._id}`);
});

// ====================== GET EDIT PROFILE FORM ======================
router.get("/edit", restrictToLoggedInUserOnly, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();
    res.render("editProfile", { user, error: null });
  } catch (error) {
    console.error("Edit profile error:", error);
    res.status(500).send("Internal Server Error");
  }
});

// ====================== UPDATE OWN PROFILE ======================
router.put("/", restrictToLoggedInUserOnly, cloudinaryUpload.single("profileImage"), async (req, res) => {
  try {
    const { fullName, bio, website, location, theme } = req.body;
    const user = await User.findById(req.user._id);

    if (fullName) user.fullName = fullName.trim();
    if (bio !== undefined) user.bio = bio.trim();
    if (website !== undefined) user.website = website.trim();
    if (location !== undefined) user.location = location.trim();
    if (theme && ["light", "dark"].includes(theme)) user.theme = theme;
    if (req.file) user.profileImageURL = req.file.path;

    await user.save();

    res.json({ success: true, message: "Profile updated", user });
  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ success: false, message: "Failed to update profile" });
  }
});

// ====================== TOGGLE PRIVACY SETTING ======================
router.put("/privacy", restrictToLoggedInUserOnly, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const newPrivacy = !user.isPrivate;

    user.isPrivate = newPrivacy;

    // If switching to public, auto-approve all pending requests
    if (!newPrivacy && (user.followRequests || []).length > 0) {
      const NotificationService = require("../services/notificationService");

      for (const requesterId of user.followRequests) {
        const requester = await User.findById(requesterId);
        if (requester) {
          // Add to each other's lists
          if (!(user.followers || []).some(id => id.toString() === requesterId.toString())) {
            user.followers.push(requesterId);
          }
          if (!(requester.following || []).some(id => id.toString() === user._id.toString())) {
            requester.following.push(user._id);
            await requester.save();
          }

          // Notify requester
          try {
            await NotificationService.createNotification(
              requesterId,
              "follow",
              {
                title: "Follow request accepted",
                message: `${user.fullName} accepted your follow request`,
                actor: user._id
              }
            );
          } catch (e) {
            console.error("Notification error (non-critical):", e.message);
          }
        }
      }
      user.followRequests = [];
    }

    await user.save();

    res.json({
      success: true,
      isPrivate: user.isPrivate,
      message: newPrivacy
        ? "Your account is now private"
        : "Your account is now public"
    });
  } catch (error) {
    console.error("Privacy toggle error:", error);
    res.status(500).json({ success: false, message: "Failed to update privacy" });
  }
});

// ====================== GET PENDING FOLLOW REQUESTS ======================
router.get("/requests", restrictToLoggedInUserOnly, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate("followRequests", "fullName profileImageURL bio")
      .lean();

    res.json({
      success: true,
      requests: user.followRequests || []
    });
  } catch (error) {
    console.error("Fetch requests error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch requests" });
  }
});

// ====================== VIEW ANY PROFILE (PUBLIC/PRIVATE AWARE) ======================
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const currentUserId = req.user?._id?.toString();

    let targetUser = await User.findById(id)
      .populate("followers", "fullName profileImageURL")
      .populate("following", "fullName profileImageURL")
      .lean();

    if (!targetUser) return res.status(404).render("404", { message: "User not found" });

    // ====== NULL-SAFETY: Ensure arrays exist for old documents ======
    targetUser.followers = targetUser.followers || [];
    targetUser.following = targetUser.following || [];
    targetUser.followRequests = targetUser.followRequests || [];
    targetUser.isPrivate = targetUser.isPrivate || false;
    targetUser.bio = targetUser.bio || "";
    targetUser.website = targetUser.website || "";
    targetUser.location = targetUser.location || "";
    targetUser.profileImageURL = targetUser.profileImageURL || "/imgs/default.png";
    // ================================================================

    const isSelf = currentUserId === id;
    const isFollower = targetUser.followers.some(
      f => f._id && f._id.toString() === currentUserId
    );
    const isAdmin = req.user?.role === "ADMIN";
    const hasAccess = isSelf || isFollower || isAdmin || !targetUser.isPrivate;

    // Counts always visible
    const counts = {
      followers: targetUser.followers.length,
      following: targetUser.following.length,
      blogs: 0
    };

    // Get blog count
    counts.blogs = await Blog.countDocuments({
      createdBy: id,
      isDeleted: false,
      status: "published"
    });

    // Base profile data (always visible)
    const profileData = {
      _id: targetUser._id,
      fullName: targetUser.fullName,
      profileImageURL: targetUser.profileImageURL,
      bio: targetUser.bio,
      website: targetUser.website,
      location: targetUser.location,
      isPrivate: targetUser.isPrivate,
      counts,
      isSelf,
      isFollowing: isFollower,
      hasPendingRequest: false
    };

    // If private and no access, show locked view
    if (targetUser.isPrivate && !hasAccess) {
      // Check if current user has sent a request
      if (currentUserId) {
        profileData.hasPendingRequest = targetUser.followRequests.some(
          rid => rid.toString() === currentUserId
        );
      }

      return res.render("profile", {
        title: `${targetUser.fullName} — Blogify`,
        user: req.user || null,
        profile: profileData,
        blogs: [],
        followersList: [],
        followingList: [],
        locked: true
      });
    }

    // Full access — fetch blogs
    const blogs = await Blog.find({
      createdBy: id,
      isDeleted: false,
      status: "published"
    })
      .sort({ createdAt: -1 })
      .populate("createdBy", "fullName profileImageURL")
      .lean();

    res.render("profile", {
      title: `${targetUser.fullName} — Blogify`,
      user: req.user || null,
      profile: {
        ...profileData,
        followersList: targetUser.followers,
        followingList: targetUser.following
      },
      blogs,
      followersList: targetUser.followers,
      followingList: targetUser.following,
      locked: false
    });
  } catch (error) {
    console.error("🚨 Profile view error:", error && error.stack ? error.stack : error);
    // Send actual error message for debugging (remove in production later)
    res.status(500).send(`Internal Server Error: ${error.message}`);
  }
});

module.exports = router;
