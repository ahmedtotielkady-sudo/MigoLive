const mongoose = require("mongoose");
const appReleaseSchema = new mongoose.Schema({
  key: { type: String, default: "current", unique: true, index: true },
  version: { type: String, required: true, match: /^\d+\.\d+\.\d+$/ },
  build: { type: Number, required: true, min: 1 },
  downloadUrl: { type: String, required: true, maxlength: 2048 },
  minVersion: { type: String, required: true, match: /^\d+\.\d+\.\d+$/ },
  notes: { type: String, default: "", maxlength: 2000 },
  force: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: true, versionKey: false });
module.exports = mongoose.models.AppRelease || mongoose.model("AppRelease", appReleaseSchema);
