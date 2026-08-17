const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/user");
const Blog = require("../models/Blog");
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const { privacyToggleLimiter } = require("../middlewares/rateLimiting");
const cloudinaryUpload = require("../middlewares/CloudinaryUploads");
const { pbkdf2Sync, timingSafeEqual } = require("crypto");

// ====================== GET OWN PROFILE DASHBOARD ======================
router.get("/", restrictToLoggedInUserOnly, async (req, res) => {
  res.redirect(`/profile/${req.user._id}`);
});

// ====================== GET SETTINGS PAGE ======================
router.get("/settings", restrictToLoggedInUserOnly, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();
    res.render("settings", { user, error: null, success: null });
  } catch (error) {
    console.error("Settings error:", error);
    res.status(500).send("Internal Server Error");
  }
});

// ====================== GET EDIT PROFILE FORM (legacy redirect) ======================
router.get("/edit", restrictToLoggedInUserOnly, async (req, res) => {
  res.redirect("/profile/settings");
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

// ====================== CHANGE PASSWORD ======================
router.put("/password", restrictToLoggedInUserOnly, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Both current and new password are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "New password must be at least 6 characters" });
    }

    const user = await User.findById(req.user._id);
    if (!user.password) {
      return res.status(400).json({ success: false, message: "Google accounts cannot change password here" });
    }

    // Verify current password
    const hashToVerify = pbkdf2Sync(currentPassword, user.salt, 100000, 64, "sha512");
    const storedHash = Buffer.from(user.password, "hex");

    if (hashToVerify.length !== storedHash.length || !timingSafeEqual(hashToVerify, storedHash)) {
      return res.status(401).json({ success: false, message: "Current password is incorrect" });
    }

    // Set new password (pre-save hook will rehash)
    user.password = newPassword;
    await user.save();

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("Change password error:", error);
    res.status(500).json({ success: false, message: "Failed to change password" });
  }
});

// ====================== UPDATE NOTIFICATION SETTINGS ======================
router.put("/notifications", restrictToLoggedInUserOnly, async (req, res) => {
  try {
    const { emailOnComment, emailOnNewFollower, emailOnLike, emailDigest } = req.body;
    const user = await User.findById(req.user._id);

    if (emailOnComment !== undefined) user.notificationSettings.emailOnComment = emailOnComment === true || emailOnComment === "true";
    if (emailOnNewFollower !== undefined) user.notificationSettings.emailOnNewFollower = emailOnNewFollower === true || emailOnNewFollower === "true";
    if (emailOnLike !== undefined) user.notificationSettings.emailOnLike = emailOnLike === true || emailOnLike === "true";
    if (emailDigest !== undefined) user.notificationSettings.emailDigest = emailDigest === true || emailDigest === "true";

    await user.save();
    res.json({ success: true, message: "Notification preferences updated" });
  } catch (error) {
    console.error("Notification settings error:", error);
    res.status(500).json({ success: false, message: "Failed to update notifications" });
  }
});

// ====================== DELETE OWN ACCOUNT ======================
router.delete("/", restrictToLoggedInUserOnly, async (req, res) => {
  try {
    // Soft delete all blogs
    await Blog.updateMany(
      { createdBy: req.user._id },
      { isDeleted: true, deletedAt: new Date() }
    );

    // Soft delete user
    await User.findByIdAndUpdate(req.user._id, {
      isDeleted: true,
      deletedAt: new Date()
    });

    res.clearCookie("token");
    res.json({ success: true, message: "Account deleted permanently", redirect: "/" });
  } catch (error) {
    console.error("Delete account error:", error);
    res.status(500).json({ success: false, message: "Failed to delete account" });
  }
});

// ====================== TOGGLE PRIVACY SETTING ======================
router.put("/privacy", restrictToLoggedInUserOnly, privacyToggleLimiter, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const newPrivacy = !user.isPrivate;

    user.isPrivate = newPrivacy;

    if (!newPrivacy && (user.followRequests || []).length > 0) {
      const NotificationService = require("../services/notificationService");

      for (const requesterId of user.followRequests) {
        const requester = await User.findById(requesterId);
        if (requester) {
          const followers = user.followers || [];
          const requesterFollowing = requester.following || [];

          if (!followers.some(id => id.toString() === requesterId.toString())) {
            user.followers.push(requesterId);
          }
          if (!requesterFollowing.some(id => id.toString() === user._id.toString())) {
            requester.following.push(user._id);
            await requester.save();
          }

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

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).render("404", { message: "User not found" });
    }

    let targetUser = await User.findById(id)
      .populate("followers", "fullName profileImageURL")
      .populate("following", "fullName profileImageURL")
      .lean();

    if (!targetUser) return res.status(404).render("404", { message: "User not found" });

    targetUser.followers = targetUser.followers || [];
    targetUser.following = targetUser.following || [];
    targetUser.followRequests = targetUser.followRequests || [];
    targetUser.isPrivate = targetUser.isPrivate || false;
    targetUser.bio = targetUser.bio || "";
    targetUser.website = targetUser.website || "";
    targetUser.location = targetUser.location || "";
    targetUser.profileImageURL = targetUser.profileImageURL || "/imgs/default.png";

    const isSelf = currentUserId === id;
    const isFollower = targetUser.followers.some(
      f => f && f._id && f._id.toString() === currentUserId
    );
    const isAdmin = req.user?.role === "ADMIN";
    const hasAccess = isSelf || isFollower || isAdmin || !targetUser.isPrivate;

    const counts = {
      followers: targetUser.followers.length,
      following: targetUser.following.length,
      blogs: 0
    };

    counts.blogs = await Blog.countDocuments({
      createdBy: id,
      isDeleted: false,
      status: "published"
    });

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

    if (targetUser.isPrivate && !hasAccess) {
      if (currentUserId) {
        profileData.hasPendingRequest = targetUser.followRequests.some(
          rid => rid && rid.toString() === currentUserId
        );
      }

      return res.render("Profile", {
        title: `${targetUser.fullName} — Blogify`,
        user: req.user || null,
        profile: profileData,
        blogs: [],
        followersList: [],
        followingList: [],
        locked: true
      });
    }

    const blogs = await Blog.find({
      createdBy: id,
      isDeleted: false,
      status: "published"
    })
      .sort({ createdAt: -1 })
      .populate("createdBy", "fullName profileImageURL")
      .lean();

    res.render("Profile", {
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
    console.error("🚨 Profile view error:", error);
    res.status(500).send(`Internal Server Error: ${error.message}`);
  }
});

module.exports = router;
