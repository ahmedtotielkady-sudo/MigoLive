const mongoose = require("mongoose");

const PlayerBetSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  amounts: { type: [Number], default: () => Array(8).fill(0) },
  totalBet: { type: Number, default: 0 },
  payout: { type: Number, default: 0 },
  settled: { type: Boolean, default: false },
  settledAt: { type: Date, default: null }
}, { _id: false });

const VeggieRoundSchema = new mongoose.Schema({
  roundNumber: { type: Number, required: true, unique: true, index: true },
  roundId: { type: String, required: true, unique: true },
  startsAt: { type: Date, required: true },
  betCloseAt: { type: Date, required: true },
  spinEndAt: { type: Date, required: true },
  resultAt: { type: Date, required: true },
  outcome: {
    type: { type: String, enum: ["single", "group"], required: true },
    index: { type: Number, default: null },
    group: { type: String, enum: ["v", "m", null], default: null },
    target: { type: Number, required: true }
  },
  bets: { type: [PlayerBetSchema], default: [] }
}, { timestamps: true });

module.exports = mongoose.models.VeggieRound || mongoose.model("VeggieRound", VeggieRoundSchema);
