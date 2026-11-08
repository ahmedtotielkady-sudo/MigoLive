const mongoose = require("mongoose");
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true, minlength: 3, maxlength: 24, unique: true, index: true },
  displayName: { type: String, trim: true, maxlength: 48, default: "" },
  legacyUid: { type: String, trim: true, sparse: true, unique: true, index: true },
  phone: { type: String, trim: true, sparse: true, unique: true, index: true },
  email: { type: String, trim: true, lowercase: true, sparse: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ["user", "admin", "owner"], default: "user" },
  status: { type: String, enum: ["active", "suspended"], default: "active" }
}, { timestamps: true, versionKey: false });
module.exports = mongoose.model("User", userSchema);
