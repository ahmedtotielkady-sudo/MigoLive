"use strict";
const mongoose = require("mongoose");
const betSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  idempotencyKey: { type: String, required: true },
  bets: { type: [Number], required: true },
  totalBet: { type: Number, required: true, min: 1 },
  settled: { type: Boolean, default: false },
  payout: { type: Number, default: 0, min: 0 }
}, { _id: false });
const roundSchema = new mongoose.Schema({
  roundNumber: { type: Number, required: true, unique: true, index: true },
  startsAt: { type: Date, required: true },
  betEndsAt: { type: Date, required: true },
  spinEndsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  outcome: { type: mongoose.Schema.Types.Mixed, required: true },
  bets: { type: [betSchema], default: [] },
  settledAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false, collection: "pizza_yam_rounds" });
module.exports = mongoose.models.PizzaYamRound || mongoose.model("PizzaYamRound", roundSchema);
