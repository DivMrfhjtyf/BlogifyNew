const express = require("express");
const router = express.Router();
const User = require("../models/user");
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const NotificationService = require("../services/notificationService");

router.use(restrictToLoggedInUserOnly);

// ====================== FOLLOW / REQUEST TO FOLLOW ======================
router.post("/:userId/follow", async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUser = await User.findById(req.user._id);
    const targetUser = await User.findById(userId);

    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ success: false, message: "Cannot follow yourself" });
    }

    // Already following?
    if (currentUser.isFollowing(userId)) {
      return res.status(400).json({ success: false, message: "Already following" });
    }

    // Already requested?
    if (targetUser.hasFollowRequestFrom(req.user._id)) {
      return res.status(400).json({ success: false, message: "Follow request already sent" });
    }

    if (targetUser.isPrivate) {
      // Send follow request
      await targetUser.sendFollowRequest(req.user._id);

      // Notify target user
      try {
        await NotificationService.createNotification(
          targetUser._id,
          "follow_request",
          {
            title: "New follow request",
            message: `${req.user.fullName} wants to follow you`,
            actor: req.user._id
          }
        );
      } catch (e) {
        console.error("Notification error (non-critical):", e.message);
      }

      return res.json({
        success: true,
        requested: true,
        following: false,
        message: "Follow request sent"
      });
    } else {
      // Public account — instant follow
      await currentUser.followUser(userId);
      await targetUser.addFollower(req.user._id);

      // Notify target user
      try {
        await NotificationService.createNotification(
          targetUser._id,
          "follow",
          {
            title: "New follower",
            message: `${req.user.fullName} started following you`,
            actor: req.user._id
          }
        );
      } catch (e) {
        console.error("Notification error (non-critical):", e.message);
      }

      return res.json({
        success: true,
        requested: false,
        following: true,
        followerCount: targetUser.followers.length + 1,
        message: "Followed successfully"
      });
    }
  } catch (error) {
    console.error("Follow error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ====================== UNFOLLOW ======================
router.post("/:userId/unfollow", async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUser = await User.findById(req.user._id);
    const targetUser = await User.findById(userId);

    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await currentUser.unfollowUser(userId);
    await targetUser.removeFollower(req.user._id);

    res.json({
      success: true,
      following: false,
      followerCount: Math.max(0, targetUser.followers.length - 1),
      message: "Unfollowed successfully"
    });
  } catch (error) {
    console.error("Unfollow error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ====================== ACCEPT FOLLOW REQUEST ======================
router.post("/requests/:requesterId/accept", async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const { requesterId } = req.params;

    if (!user.hasFollowRequestFrom(requesterId)) {
      return res.status(400).json({ success: false, message: "No pending request found" });
    }

    await user.acceptFollowRequest(requesterId);

    const requester = await User.findById(requesterId);
    if (requester) {
      await requester.followUser(req.user._id);
    }

    // Notify requester
    try {
      await NotificationService.createNotification(
        requesterId,
        "follow",
        {
          title: "Follow request accepted",
          message: `${req.user.fullName} accepted your follow request`,
          actor: req.user._id
        }
      );
    } catch (e) {
      console.error("Notification error (non-critical):", e.message);
    }

    res.json({ success: true, message: "Follow request accepted" });
  } catch (error) {
    console.error("Accept request error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ====================== REJECT FOLLOW REQUEST ======================
router.post("/requests/:requesterId/reject", async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const { requesterId } = req.params;

    if (!user.hasFollowRequestFrom(requesterId)) {
      return res.status(400).json({ success: false, message: "No pending request found" });
    }

    await user.rejectFollowRequest(requesterId);

    res.json({ success: true, message: "Follow request rejected" });
  } catch (error) {
    console.error("Reject request error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ====================== CANCEL FOLLOW REQUEST ======================
router.post("/requests/:userId/cancel", async (req, res) => {
  try {
    const { userId } = req.params;
    const targetUser = await User.findById(userId);

    if (!targetUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    await targetUser.cancelFollowRequest(req.user._id);

    res.json({ success: true, message: "Follow request cancelled" });
  } catch (error) {
    console.error("Cancel request error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ====================== GET FOLLOWERS ======================
router.get("/:userId/followers", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId)
      .populate("followers", "fullName profileImageURL bio")
      .lean();

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Privacy check
    const isSelf = req.user._id.toString() === userId;
    const isFollower = user.followers.some(f => f._id.toString() === req.user._id.toString());
    const isAdmin = req.user.role === "ADMIN";

    if (user.isPrivate && !isSelf && !isFollower && !isAdmin) {
      return res.status(403).json({ success: false, message: "This account is private" });
    }

    res.json({ success: true, followers: user.followers });
  } catch (error) {
    console.error("Get followers error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ====================== GET FOLLOWING ======================
router.get("/:userId/following", async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId)
      .populate("following", "fullName profileImageURL bio")
      .lean();

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    // Privacy check
    const isSelf = req.user._id.toString() === userId;
    const isFollower = user.followers.some(f => f._id.toString() === req.user._id.toString());
    const isAdmin = req.user.role === "ADMIN";

    if (user.isPrivate && !isSelf && !isFollower && !isAdmin) {
      return res.status(403).json({ success: false, message: "This account is private" });
    }

    res.json({ success: true, following: user.following });
  } catch (error) {
    console.error("Get following error:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
