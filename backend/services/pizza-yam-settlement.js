"use strict";
const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const GameRound = require("../models/GameRound");
const PizzaYamRound = require("../models/PizzaYamRound");
const pizzaYam = require("../game-engines/pizza-yam");

async function settleBet(roundNumber, idempotencyKey) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const round = await PizzaYamRound.findOne({ roundNumber }).session(session);
      if (!round || Date.now() < new Date(round.spinEndsAt).getTime()) return;
      const bet = round.bets.find(item => item.idempotencyKey === idempotencyKey);
      if (!bet || bet.settled) return;
      const winning = Array.isArray(round.outcome.winningIndices) ? round.outcome.winningIndices : [];
      const payout = winning.reduce((sum, index) => sum + Number(bet.bets[index] || 0) * pizzaYam.FOODS[index].multiplier, 0);
      const user = await User.findById(bet.userId).session(session);
      if (!user) throw new Error("Pizza Yam bettor account missing");
      if (payout > 0) {
        user.coins += payout;
        await user.save({ session });
        await Wallet.updateOne({ userId: user._id }, { $set: { balance: user.coins } }, { upsert: true, session });
        await WalletTransaction.create([{
          to: user._id, amount: payout, type: "game_reward",
          description: "مكسب بيتزا يم - الجولة " + roundNumber,
          idempotencyKey: idempotencyKey + "_win"
        }], { session });
      }
      const marked = await PizzaYamRound.updateOne(
        { _id: round._id, bets: { $elemMatch: { idempotencyKey, settled: false } } },
        { $set: { "bets.$.settled": true, "bets.$.payout": payout } },
        { session }
      );
      if (!marked.modifiedCount) return;
      await GameRound.create([{
        userId: user._id, gameId: "pizza-yam",
        roundId: "pizza-yam-" + roundNumber + "-" + idempotencyKey,
        idempotencyKey: idempotencyKey + "_round",
        bet: bet.totalBet, payout,
        status: payout > 0 ? "settled" : "lost",
        outcome: { targetIndex: round.outcome.targetIndex, group: round.outcome.group,
          winningIndices: winning, requestedBets: bet.bets },
        settledAt: new Date()
      }], { session });
    });
  } finally { await session.endSession(); }
}
async function settleDueRounds() {
  const now = new Date();
  const rounds = await PizzaYamRound.find({ spinEndsAt: { $lte: now }, "bets.settled": false })
    .select("roundNumber bets.idempotencyKey bets.settled").limit(100).lean();
  for (const round of rounds) {
    for (const bet of round.bets || []) {
      if (!bet.settled) {
        try { await settleBet(round.roundNumber, bet.idempotencyKey); }
        catch (error) { console.error("Pizza Yam settlement retry:", error.message); }
      }
    }
  }
}
module.exports = { settleDueRounds };
