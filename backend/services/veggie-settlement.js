"use strict";
const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const VeggieRound = require("../models/VeggieRound");
const veggie = require("../game-engines/veggie");

let timer = null;
let running = false;

async function settleRoundBet(roundId, userId) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const round = await VeggieRound.findOne({ roundId, spinEndAt: { $lte: new Date() } }).session(session);
      if (!round) return;
      const bet = round.bets.find(item => String(item.userId) === String(userId));
      if (!bet || bet.settled) return;
      const payout = veggie.payoutFor(bet.amounts, round.outcome);
      const claimed = await VeggieRound.updateOne(
        { _id: round._id, bets: { $elemMatch: { userId, settled: false } } },
        { $set: {
          "bets.$.settled": true,
          "bets.$.payout": payout,
          "bets.$.settledAt": new Date()
        } },
        { session }
      );
      if (!claimed.modifiedCount || payout <= 0) return;
      const user = await User.findById(userId).session(session).select("coins");
      if (!user) throw new Error("Veggie settlement user no longer exists");
      user.coins += payout;
      await user.save({ session });
      await Wallet.updateOne(
        { userId: user._id },
        { $set: { balance: user.coins } },
        { upsert: true, session }
      );
      await WalletTransaction.create([{
        to: user._id,
        amount: payout,
        type: "game_reward",
        description: "مكسب لعبة خضار",
        idempotencyKey: "veggie_" + round.roundId + "_" + String(user._id) + "_win"
      }], { session });
    });
  } finally {
    await session.endSession();
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const due = await VeggieRound.find({
      spinEndAt: { $lte: new Date() },
      "bets.settled": false
    }).select("roundId bets.userId bets.settled").limit(40).lean();
    for (const round of due) {
      for (const bet of round.bets || []) {
        if (bet && !bet.settled) {
          try { await settleRoundBet(round.roundId, bet.userId); }
          catch (error) { console.error("Veggie settlement failed:", error.message); }
        }
      }
    }
  } catch (error) {
    console.error("Veggie settlement worker failed:", error.message);
  } finally {
    running = false;
  }
}

function startVeggieSettlementWorker() {
  if (timer) return;
  timer = setInterval(tick, 2000);
  if (typeof timer.unref === "function") timer.unref();
  tick();
}
module.exports = { startVeggieSettlementWorker, tick };
