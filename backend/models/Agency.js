const mongoose = require("mongoose");

const memberSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  active: { type: Boolean, default: true },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  addedAt: { type: Date, default: Date.now }
}, { _id: false });

const agencySchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 60 },
  type: { type: String, enum: ["host", "shipping"], required: true, index: true },
  status: { type: String, enum: ["pending", "active", "rejected", "suspended"], default: "pending", index: true },
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  members: { type: [memberSchema], default: [] },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  reviewedAt: Date,
  reviewNote: { type: String, maxlength: 300, default: "" }
}, { timestamps: true, versionKey: false });

agencySchema.index({ type: 1, ownerId: 1, status: 1 });
module.exports = mongoose.model("Agency", agencySchema);
