const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const NotificationSchema = new Schema({
  recipient: {
    type: Schema.Types.ObjectId,
    ref: "user",
    required: true
  },

  type: {
    type: String,
    enum: ["comment", "reply", "like", "follow", "follow_request", "mention", "blog_post"],
    required: true
  },

  title: String,
  message: String,

  // Related entities
  blog: {
    type: Schema.Types.ObjectId,
    ref: "blog"
  },

  actor: {
    type: Schema.Types.ObjectId,
    ref: "user"
  },

  // Status
  isRead: { type: Boolean, default: false },

}, { timestamps: true });

// Index for performance
NotificationSchema.index({ recipient: 1, isRead: 1 });
NotificationSchema.index({ createdAt: -1 });

const Notification = mongoose.models.Notification || model("Notification", NotificationSchema);
module.exports = Notification;
