const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  reference: { type: String, required: true, unique: true },
  betIndex: { type: Number, required: true, min: 0, max: 6 },
  freeSpin: { type: Boolean, required: true },
  grid: { type: [[String]], required: true },
  win: { type: Number, required: true, min: 0 },
  scatterCount: { type: Number, required: true, min: 0, max: 20 },
  freeSpinsAwarded: { type: Number, required: true, min: 0 },
  freeSpinsRemaining: { type: Number, required: true, min: 0 },
  multiplier: { type: Number, required: true, min: 1, max: 10 },
  balance: { type: Number, required: true, min: 0 },
  hit: { type: [String], default: [] },
  freeSpinWinnings: { type: Number, required: true, min: 0 }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model("CleopatraGoldRound", schema);
