const express = require("express");
const router = express.Router();
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const NotificationService = require("../services/notificationService");

router.use(restrictToLoggedInUserOnly);

// ====================== GET NOTIFICATIONS (HTML or JSON) ======================
router.get("/", async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    // Graceful fallback if service method doesn't exist
    let result;
    if (NotificationService.getUserNotifications) {
      result = await NotificationService.getUserNotifications(
        req.user._id,
        parseInt(limit),
        parseInt(page)
      );
    } else {
      // Fallback: query directly
      const Notification = require("../models/Notification");
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [notifications, total] = await Promise.all([
        Notification.find({ recipient: req.user._id })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit))
          .populate("actor", "fullName profileImageURL")
          .populate("blog", "title")
          .lean(),
        Notification.countDocuments({ recipient: req.user._id })
      ]);
      result = { notifications, total, pages: Math.ceil(total / parseInt(limit)) };
    }

    // Content negotiation: Browser -> HTML page, API/JS -> JSON
    const accept = req.headers.accept || "";
    if (accept.includes("text/html")) {
      return res.render("notification", {
        user: req.user,
        notifications: result.notifications || [],
        total: result.total || 0,
        pages: result.pages || 1,
        currentPage: parseInt(page)
      });
    }

    res.json({
      success: true,
      notifications: result.notifications || [],
      total: result.total || 0,
      pages: result.pages || 1,
      currentPage: parseInt(page)
    });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ success: false, message: "Failed to fetch notifications" });
  }
});

// ====================== GET UNREAD COUNT ======================
router.get("/unread/count", async (req, res) => {
  try {
    let count = 0;
    if (NotificationService.getUnreadCount) {
      count = await NotificationService.getUnreadCount(req.user._id);
    } else {
      const Notification = require("../models/Notification");
      count = await Notification.countDocuments({ recipient: req.user._id, isRead: false });
    }
    res.json({ success: true, unreadCount: count });
  } catch (error) {
    console.error("Error getting unread count:", error);
    res.status(500).json({ success: false, message: "Failed to get unread count" });
  }
});

// ====================== MARK AS READ ======================
router.put("/:notificationId/read", async (req, res) => {
  try {
    if (NotificationService.markAsRead) {
      await NotificationService.markAsRead(req.params.notificationId);
    } else {
      const Notification = require("../models/Notification");
      await Notification.findByIdAndUpdate(req.params.notificationId, { isRead: true });
    }
    res.json({ success: true, message: "Marked as read" });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ success: false, message: "Failed to mark as read" });
  }
});

// ====================== MARK ALL AS READ ======================
router.put("/all/read", async (req, res) => {
  try {
    if (NotificationService.markAllAsRead) {
      await NotificationService.markAllAsRead(req.user._id);
    } else {
      const Notification = require("../models/Notification");
      await Notification.updateMany(
        { recipient: req.user._id, isRead: false },
        { isRead: true }
      );
    }
    res.json({ success: true, message: "All marked as read" });
  } catch (error) {
    console.error("Error marking all as read:", error);
    res.status(500).json({ success: false, message: "Failed to mark all as read" });
  }
});

// ====================== DELETE NOTIFICATION ======================
router.delete("/:notificationId", async (req, res) => {
  try {
    const { notificationId } = req.params;
    let deleted = false;

    if (NotificationService.deleteNotification) {
      deleted = await NotificationService.deleteNotification(notificationId, req.user._id);
    } else {
      const Notification = require("../models/Notification");
      const result = await Notification.findOneAndDelete({
        _id: notificationId,
        recipient: req.user._id
      });
      deleted = !!result;
    }

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }
    res.json({ success: true, message: "Notification deleted" });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ success: false, message: "Failed to delete notification" });
  }
});

module.exports = router;
