const mongoose = require("mongoose");
const { Schema, model } = mongoose;
const { createHmac, randomBytes } = require("crypto");
const { creatTokenForUser } = require("../services/authentication");

const UserSchema = new Schema({
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  salt: { type: String },
  password: { type: String },
  googleId: {
    type: String,
    unique: true,
    sparse: true
  },
  profileImageURL: {
    type: String,
    default: "/imgs/default.png"
  },

  // Profile Enhancements
  bio: {
    type: String,
    default: "",
    maxlength: 500
  },
  website: {
    type: String,
    default: ""
  },
  location: {
    type: String,
    default: ""
  },

  role: {
    type: String,
    enum: ["USER", "ADMIN"],
    default: "USER"
  },

  theme: {
    type: String,
    enum: ["light", "dark"],
    default: "light"
  },

  // ====== PRIVACY ======
  isPrivate: {
    type: Boolean,
    default: false
  },

  // Pending follow requests (only used when isPrivate = true)
  followRequests: [{
    type: Schema.Types.ObjectId,
    ref: "user"
  }],

  // Social Features
  followers: [{
    type: Schema.Types.ObjectId,
    ref: "user"
  }],
  following: [{
    type: Schema.Types.ObjectId,
    ref: "user"
  }],

  // Notification Settings
  notificationSettings: {
    emailOnComment: { type: Boolean, default: true },
    emailOnNewFollower: { type: Boolean, default: true },
    emailOnLike: { type: Boolean, default: false },
    emailDigest: { type: Boolean, default: true }
  },

}, { timestamps: true });

// ====================== INDEXES ======================
UserSchema.index({ email: 1 });
UserSchema.index({ followers: 1 });
UserSchema.index({ following: 1 });
UserSchema.index({ isPrivate: 1 });

// ====================== VIRTUALS ======================
UserSchema.virtual("followerCount").get(function() {
  return this.followers ? this.followers.length : 0;
});

UserSchema.virtual("followingCount").get(function() {
  return this.following ? this.following.length : 0;
});

// ====================== PASSWORD HASHING ======================
UserSchema.pre("save", async function (next) {
  if (this.googleId || !this.password || !this.isModified("password")) {
    return next();
  }

  try {
    const salt = randomBytes(16).toString("hex");
    this.salt = salt;
    this.password = createHmac("sha256", salt)
      .update(this.password)
      .digest("hex");
    next();
  } catch (error) {
    next(error);
  }
});

// ====================== STATIC METHODS ======================
UserSchema.static("matchPassword", async function (email, password) {
  const user = await this.findOne({ email: email.toLowerCase() });
  if (!user) throw new Error("User not found");
  if (!user.password) throw new Error("This account uses Google Sign-In");

  const userProvidedHash = createHmac("sha256", user.salt)
    .update(password)
    .digest("hex");

  if (user.password !== userProvidedHash) throw new Error("Incorrect Password");

  return creatTokenForUser(user);
});

UserSchema.static("findOrCreateGoogleUser", async function (profile) {
  try {
    const email = profile.emails[0].value.toLowerCase();
    const googleId = profile.id;

    let user = await this.findOne({ googleId });

    if (!user) {
      user = await this.findOne({ email });

      if (user) {
        user.googleId = googleId;
        if (profile.photos?.[0]?.value) {
          user.profileImageURL = profile.photos[0].value;
        }
        await user.save();
      } else {
        user = await this.create({
          fullName: profile.displayName || "Google User",
          email: email,
          googleId: googleId,
          profileImageURL: profile.photos?.[0]?.value || "/imgs/default.png"
        });
      }
    }

    return user;
  } catch (error) {
    console.error("❌ findOrCreateGoogleUser Error:", error.message);
    throw error;
  }
});

// ====================== FOLLOW METHODS ======================
UserSchema.methods.followUser = async function(userId) {
  const uid = userId.toString();
  if (!this.following.some(id => id.toString() === uid)) {
    this.following.push(userId);
    await this.save();
  }
};

UserSchema.methods.unfollowUser = async function(userId) {
  const uid = userId.toString();
  this.following = this.following.filter(id => id.toString() !== uid);
  await this.save();
};

UserSchema.methods.isFollowing = function(userId) {
  const uid = userId.toString();
  return this.following.some(id => id.toString() === uid);
};

UserSchema.methods.addFollower = async function(userId) {
  const uid = userId.toString();
  if (!this.followers.some(id => id.toString() === uid)) {
    this.followers.push(userId);
    await this.save();
  }
};

UserSchema.methods.removeFollower = async function(userId) {
  const uid = userId.toString();
  this.followers = this.followers.filter(id => id.toString() !== uid);
  await this.save();
};

// ====================== FOLLOW REQUEST METHODS ======================
UserSchema.methods.hasFollowRequestFrom = function(userId) {
  const uid = userId.toString();
  return this.followRequests.some(id => id.toString() === uid);
};

UserSchema.methods.sendFollowRequest = async function(requesterId) {
  const rid = requesterId.toString();

  if (this.followers.some(id => id.toString() === rid)) {
    throw new Error("Already following this user");
  }
  if (this.followRequests.some(id => id.toString() === rid)) {
    throw new Error("Follow request already sent");
  }

  this.followRequests.push(requesterId);
  await this.save();
};

UserSchema.methods.acceptFollowRequest = async function(requesterId) {
  const rid = requesterId.toString();

  this.followRequests = this.followRequests.filter(
    id => id.toString() !== rid
  );

  if (!this.followers.some(id => id.toString() === rid)) {
    this.followers.push(requesterId);
  }
  await this.save();
};

UserSchema.methods.rejectFollowRequest = async function(requesterId) {
  const rid = requesterId.toString();
  this.followRequests = this.followRequests.filter(
    id => id.toString() !== rid
  );
  await this.save();
};

UserSchema.methods.cancelFollowRequest = async function(requesterId) {
  const rid = requesterId.toString();
  this.followRequests = this.followRequests.filter(
    id => id.toString() !== rid
  );
  await this.save();
};

// ====================== CREATE MODEL ======================
const User = mongoose.models.user || model("user", UserSchema);
module.exports = User;
