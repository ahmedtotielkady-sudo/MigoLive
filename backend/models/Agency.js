const mongoose = require("mongoose");

const joinRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  username: { type: String, required: true },
  status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" },
  createdAt: { type: Date, default: Date.now },
  decidedAt: { type: Date, default: null }
}, { _id: true });

const agencySchema = new mongoose.Schema({
  agencyId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 3, maxlength: 60 },
  description: { type: String, trim: true, maxlength: 500, default: "" },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  status: { type: String, enum: ["pending", "active", "rejected", "suspended"], default: "pending", index: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  joinRequests: [joinRequestSchema],
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

agencySchema.index({ ownerId: 1, status: 1 });
module.exports = mongoose.model("Agency", agencySchema);
