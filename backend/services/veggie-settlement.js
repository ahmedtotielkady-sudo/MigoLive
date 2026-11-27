"use strict";
const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const VeggieRound = require("../models/VeggieRound");
const veggie = require("../game-engines/veggie");

// Keep the shared round clock alive even when no player has the game open.
const EPOCH = Date.UTC(2026, 0, 1);
async function ensureCurrentRound(now = new Date()) {
  const roundNumber = Math.max(0, Math.floor((now.getTime() - EPOCH) / (veggie.CYCLE_SECONDS * 1000)));
  const startsAt = new Date(EPOCH + roundNumber * veggie.CYCLE_SECONDS * 1000);
  try {
    await VeggieRound.findOneAndUpdate({ roundNumber }, { $setOnInsert: {
      roundNumber, roundId: require("crypto").randomUUID(), startsAt,
      betCloseAt: new Date(startsAt.getTime() + veggie.BET_SECONDS * 1000),
      spinEndAt: new Date(startsAt.getTime() + (veggie.BET_SECONDS + veggie.SPIN_SECONDS) * 1000),
      resultAt: new Date(startsAt.getTime() + veggie.CYCLE_SECONDS * 1000),
      outcome: veggie.createOutcome(), bets: []
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  } catch (error) {
    if (!error || error.code !== 11000) throw error;
    // Another worker/request created this round concurrently.
  }
}

let timer = null;
let running = false;

async function settleRoundBet(roundId, userId, io) {
  const session = await mongoose.startSession();
  let settledCoins = null;
  try {
    await session.withTransaction(async () => {
      // The transaction callback may be retried; only notify after commit.
      settledCoins = null;
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
      settledCoins = user.coins;
    });
    if (settledCoins !== null && io) {
      io.to("user:" + String(userId)).emit("wallet:updated", { coins: settledCoins });
    }
  } finally {
    await session.endSession();
  }
}

async function tick(io) {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    await ensureCurrentRound(now);
    const due = await VeggieRound.find({
      spinEndAt: { $lte: new Date() },
      "bets.settled": false
    }).select("roundId bets.userId bets.settled").limit(40).lean();
    for (const round of due) {
      for (const bet of round.bets || []) {
        if (bet && !bet.settled) {
          try { await settleRoundBet(round.roundId, bet.userId, io); }
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

function startVeggieSettlementWorker(io) {
  if (timer) return;
  timer = setInterval(() => tick(io), 1000);
  if (typeof timer.unref === "function") timer.unref();
  tick(io);
}
module.exports = { startVeggieSettlementWorker, tick };
