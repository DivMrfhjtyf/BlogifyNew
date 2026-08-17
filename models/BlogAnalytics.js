const mongoose = require("mongoose");
const { Schema, model } = mongoose;

const BlogAnalyticsSchema = new Schema({
  blog: {
    type: Schema.Types.ObjectId,
    ref: "blog",
    required: true
  },

  author: {
    type: Schema.Types.ObjectId,
    ref: "user",
    required: true
  },

  totalViews: { type: Number, default: 0 },
  totalLikes: { type: Number, default: 0 },
  totalComments: { type: Number, default: 0 },
  totalShares: { type: Number, default: 0 },

  // Daily stats
  dailyViews: [{
    date: Date,
    count: Number
  }],

  // Source tracking
  viewSource: {
    direct: { type: Number, default: 0 },
    search: { type: Number, default: 0 },
    social: { type: Number, default: 0 },
    referral: { type: Number, default: 0 }
  },

  // Device tracking
  deviceStats: {
    mobile: { type: Number, default: 0 },
    tablet: { type: Number, default: 0 },
    desktop: { type: Number, default: 0 }
  },

  // Geography
  topCountries: [{
    country: String,
    views: Number
  }],

}, { timestamps: true });

BlogAnalyticsSchema.index({ blog: 1 });
BlogAnalyticsSchema.index({ author: 1 });

// ====================== STATIC HELPERS ======================

// Increment total likes
BlogAnalyticsSchema.statics.incrementLikes = async function(blogId) {
  await this.findOneAndUpdate(
    { blog: blogId },
    { $inc: { totalLikes: 1 } },
    { upsert: true, new: true }
  );
};

// Decrement total likes
BlogAnalyticsSchema.statics.decrementLikes = async function(blogId) {
  await this.findOneAndUpdate(
    { blog: blogId },
    { $inc: { totalLikes: -1 } },
    { upsert: true, new: true }
  );
};

// Increment total comments
BlogAnalyticsSchema.statics.incrementComments = async function(blogId) {
  await this.findOneAndUpdate(
    { blog: blogId },
    { $inc: { totalComments: 1 } },
    { upsert: true, new: true }
  );
};

// Decrement total comments (on delete)
BlogAnalyticsSchema.statics.decrementComments = async function(blogId) {
  await this.findOneAndUpdate(
    { blog: blogId },
    { $inc: { totalComments: -1 } },
    { upsert: true, new: true }
  );
};

// Increment total views
BlogAnalyticsSchema.statics.incrementViews = async function(blogId, source = "direct") {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const update = {
    $inc: { totalViews: 1 }
  };

  // Increment source
  if (["direct", "search", "social", "referral"].includes(source)) {
    update.$inc[`viewSource.${source}`] = 1;
  }

  // Upsert daily view
  const doc = await this.findOne({ blog: blogId });
  if (doc) {
    const existingDay = doc.dailyViews.find(d => {
      const dDate = new Date(d.date);
      dDate.setHours(0, 0, 0, 0);
      return dDate.getTime() === today.getTime();
    });

    if (existingDay) {
      await this.findOneAndUpdate(
        { blog: blogId, "dailyViews.date": { $gte: today, $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000) } },
        { $inc: { "dailyViews.$.count": 1, ...update.$inc } },
        { new: true }
      );
    } else {
      await this.findOneAndUpdate(
        { blog: blogId },
        { $push: { dailyViews: { date: today, count: 1 } }, $inc: update.$inc },
        { upsert: true, new: true }
      );
    }
  } else {
    await this.create({
      blog: blogId,
      author: null, // Will be set on first creation
      totalViews: 1,
      viewSource: { [source]: 1 },
      dailyViews: [{ date: today, count: 1 }]
    });
  }
};

const BlogAnalytics = mongoose.models.BlogAnalytics || model("BlogAnalytics", BlogAnalyticsSchema);
module.exports = BlogAnalytics;
