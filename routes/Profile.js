const express = require("express");
const router = express.Router();
const Blog = require("../models/Blog");
const User = require("../models/user");
const { restrictToLoggedInUserOnly } = require("../middlewares/authentication");
const cloudinaryUpload = require("../middlewares/CloudinaryUploads");

router.use(restrictToLoggedInUserOnly);

// ====================== GET USER PROFILE ======================
router.get("/", restrictToLoggedInUserOnly, async (req, res) => {
    try {
        const fullUser = await User.findById(req.user._id)
            .populate("followers", "fullName email profileImageURL bio")
            .populate("following", "fullName email profileImageURL bio");

        if (!fullUser) {
            return res.status(404).send("User not found");
        }

        const blogs = await Blog.find({ createdBy: req.user._id, isDeleted: false })
            .sort({ createdAt: -1 });

        res.render("profile", {
            user: fullUser,
            blogs: blogs || []
        });
    } catch (error) {
        console.error("🚨 Profile Route Error:", error.message);
        res.status(500).send("Internal Server Error");
    }
});

// ====================== GET SETTINGS PAGE ======================
router.get("/settings", restrictToLoggedInUserOnly, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).send("User not found");
        }
        res.render("settings", { user: user });
    } catch (error) {
        console.error("Settings Page Error:", error);
        res.status(500).render("error", { error: error.message });
    }
});

// ====================== UPDATE PROFILE ======================
router.put("/update", async (req, res) => {
    try {
        const { fullName, bio, website, location } = req.body;

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: "User not found" 
            });
        }

        user.fullName = fullName || user.fullName;
        user.bio = bio || user.bio;
        user.website = website || user.website;
        user.location = location || user.location;

        await user.save();

        res.json({ 
            success: true, 
            message: "Profile updated successfully",
            user: user
        });
    } catch (error) {
        console.error("Update Profile Error:", error);
        res.status(500).json({ 
            success: false, 
            message: error.message || "Failed to update profile" 
        });
    }
});

// ====================== UPDATE NOTIFICATIONS ======================
router.put("/update-notifications", async (req, res) => {
    try {
        const { emailOnComment, emailOnNewFollower, emailDigest } = req.body;

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        user.notificationSettings = {
            emailOnComment: emailOnComment !== false,
            emailOnNewFollower: emailOnNewFollower !== false,
            emailDigest: emailDigest !== false
        };

        await user.save();

        res.json({ 
            success: true, 
            message: "Notification preferences updated"
        });
    } catch (error) {
        console.error("Update Notifications Error:", error);
        res.status(500).json({ success: false, message: "Failed to update preferences" });
    }
});

// ====================== UPDATE THEME ======================
router.put("/update-theme", async (req, res) => {
    try {
        const { theme } = req.body;

        if (!['light', 'dark'].includes(theme)) {
            return res.status(400).json({ success: false, message: "Invalid theme" });
        }

        const user = await User.findById(req.user._id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        user.theme = theme;
        await user.save();

        res.json({ 
            success: true, 
            message: "Theme updated successfully"
        });
    } catch (error) {
        console.error("Update Theme Error:", error);
        res.status(500).json({ success: false, message: "Failed to update theme" });
    }
});

// ====================== UPLOAD PROFILE IMAGE ======================
router.post("/upload-image", cloudinaryUpload.single("profileImage"), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                message: "No image uploaded" 
            });
        }

        const user = await User.findById(req.user._id);
        user.profileImageURL = req.file.path;
        await user.save();

        res.json({ 
            success: true, 
            message: "Profile image updated",
            imageURL: req.file.path
        });
    } catch (error) {
        console.error("Upload Image Error:", error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to upload image" 
        });
    }
});

// ====================== CHANGE PASSWORD ======================
router.post("/change-password", async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ 
                success: false, 
                message: "Current and new passwords are required" 
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ 
                success: false, 
                message: "New password must be at least 6 characters" 
            });
        }

        const user = await User.findById(req.user._id);
        
        if (user.googleId && !user.password) {
            return res.status(400).json({ 
                success: false, 
                message: "This account uses Google Sign-In. Cannot change password." 
            });
        }

        const { createHmac } = require("crypto");
        const currentHash = createHmac("sha256", user.salt)
            .update(currentPassword)
            .digest("hex");

        if (user.password !== currentHash) {
            return res.status(401).json({ 
                success: false, 
                message: "Current password is incorrect" 
            });
        }

        user.password = newPassword;
        await user.save();

        res.json({ 
            success: true, 
            message: "Password changed successfully" 
        });
    } catch (error) {
        console.error("Change Password Error:", error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to change password" 
        });
    }
});

// ====================== DELETE ACCOUNT ======================
router.delete("/delete-account", async (req, res) => {
    try {
        const userId = req.user._id;

        await Blog.deleteMany({ createdBy: userId });
        await User.findByIdAndDelete(userId);

        res.clearCookie("token");

        res.json({ 
            success: true, 
            message: "Account deleted successfully" 
        });
    } catch (error) {
        console.error("Delete Account Error:", error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to delete account" 
        });
    }
});

module.exports = router;