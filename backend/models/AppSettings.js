"use strict";
const mongoose = require("mongoose");

const AppSettingsSchema = new mongoose.Schema({
  _id: { type: String, default: "global" },
  public: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  revision: { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: false, versionKey: false });

module.exports = mongoose.models.AppSettings ||
  mongoose.model("AppSettings", AppSettingsSchema);
