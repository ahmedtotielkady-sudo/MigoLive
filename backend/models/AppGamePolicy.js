"use strict";
const mongoose = require("mongoose");

const AppGamePolicySchema = new mongoose.Schema({
  _id: { type: String, default: "global" },
  games: {
    type: Map,
    of: new mongoose.Schema({
      enabled: { type: Boolean, default: true },
      updatedAt: { type: Date, default: Date.now },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
    }, { _id: false }),
    default: () => ({})
  },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: false, versionKey: false });

module.exports = mongoose.models.AppGamePolicy ||
  mongoose.model("AppGamePolicy", AppGamePolicySchema);
