const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  freeSpins: { type: Number, required: true, default: 0, min: 0, max: 1000 },
  multiplier: { type: Number, required: true, default: 1, min: 1, max: 10 },
  freeSpinWinnings: { type: Number, required: true, default: 0, min: 0 },
  freeSpinBetIndex: { type: Number, default: null, min: 0, max: 6 }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model("CleopatraGoldState", schema);
