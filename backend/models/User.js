const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  uid: { type: Number, required: true, unique: true, index: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 24, index: true },
  displayName: { type: String, required: true, trim: true, maxlength: 40 },
  phone: { type: String, default: "", sparse: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  coins: { type: Number, default: 100, min: 0 },
  role: { type: String, enum: ["user", "admin", "owner"], default: "user" },
  avatar: { type: String, default: "" },
  status: { type: String, enum: ["active", "banned"], default: "active" },
  lastLoginAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

userSchema.index({ phone: 1 }, { unique: true, sparse: true });
module.exports = mongoose.models.User || mongoose.model("User", userSchema);
