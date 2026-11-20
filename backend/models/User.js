const mongoose = require("mongoose");
const userSchema = new mongoose.Schema({
  uid: { type: Number, required: true, unique: true, index: true },
  username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 24, index: true },
  displayName: { type: String, required: true, trim: true, maxlength: 40 },
  phone: { type: String, default: undefined },
  email: { type: String, lowercase: true, trim: true, default: undefined },
  passwordHash: { type: String, required: true, select: false },
  coins: { type: Number, default: 0, min: 0 },
  role: { type: String, enum: ["user", "admin", "owner"], default: "user" },
  avatar: { type: String, default: "" },
  status: { type: String, enum: ["active", "banned"], default: "active" },
  lastLoginAt: { type: Date, default: null },
  activeSessionId: { type: String, default: null, select: false },
  activeSessionExpiresAt: { type: Date, default: null, select: false }
}, { timestamps: true, versionKey: false });
userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: "string" } } });
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: "string" } } });
module.exports = mongoose.models.User || mongoose.model("User", userSchema);
