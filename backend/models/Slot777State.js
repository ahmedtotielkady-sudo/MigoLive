const mongoose = require("mongoose");

const slot777StateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  freeSpins: { type: Number, required: true, default: 0, min: 0, max: 1000 }
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model("Slot777State", slot777StateSchema);
