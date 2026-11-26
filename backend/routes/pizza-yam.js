"use strict";
const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const GameRound = require("../models/GameRound");
const pizzaYam = require("../game-engines/pizza-yam");
const router = express.Router();
router.use(require("../middleware/requireAuth"));

router.post("/pizza-yam/spin", async (req, res) => {
  const key = String(req.get("idempotency-key") || "");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key))
    return res.status(400).json({ ok: false, message: "معرّف الجولة مطلوب" });
  const input = { foodIndex: req.body && req.body.foodIndex, bet: req.body && req.body.bet };
  const session = await mongoose.startSession();
  try {
    let response;
    await session.withTransaction(async () => {
      const prior = await GameRound.findOne({ idempotencyKey: key }).session(session);
      if (prior) {
        if (String(prior.userId) !== req.auth.sub || prior.gameId !== "pizza-yam" ||
            Number(prior.outcome && prior.outcome.selectedIndex) !== Number(input.foodIndex) ||
            Number(prior.outcome && prior.outcome.requestedBet) !== Number(input.bet))
          throw Object.assign(new Error("معرّف الجولة مستخدم لطلب مختلف"), { status: 409 });
        const current = await User.findById(req.auth.sub).session(session).select("coins");
        if (!current) throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
        response = { roundId: prior.roundId, coins: current.coins, bet: prior.bet, payout: prior.payout, outcome: prior.outcome, repeated: true };
        return;
      }
      const user = await User.findOne({ _id: req.auth.sub, status: "active" }).session(session).select("coins");
      if (!user) throw Object.assign(new Error("الحساب غير موجود أو غير نشط"), { status: 404 });
      const outcome = pizzaYam.play(input);
      if (user.coins < outcome.totalBet)
        throw Object.assign(new Error("رصيدك غير كافٍ"), { status: 409, currentCoins: user.coins });
      user.coins -= outcome.totalBet;
      await WalletTransaction.create([{
        from: user._id, amount: outcome.totalBet, type: "game_bet",
        description: "رهان بيتزا يم", idempotencyKey: key + "_bet"
      }], { session });
      if (outcome.payout > 0) {
        user.coins += outcome.payout;
        await WalletTransaction.create([{
          to: user._id, amount: outcome.payout, type: "game_reward",
          description: "مكسب بيتزا يم", idempotencyKey: key + "_win"
        }], { session });
      }
      await user.save({ session });
      await Wallet.updateOne({ userId: user._id }, { $set: { balance: user.coins } }, { upsert: true, session });
      const roundId = crypto.randomUUID();
      const savedOutcome = { ...outcome, requestedBet: input.bet };
      const [round] = await GameRound.create([{
        userId: user._id, gameId: "pizza-yam", roundId, idempotencyKey: key,
        bet: outcome.totalBet, payout: outcome.payout,
        status: outcome.payout > 0 ? "settled" : "lost", outcome: savedOutcome, settledAt: new Date()
      }], { session });
      response = { roundId: round.roundId, coins: user.coins, bet: outcome.totalBet, payout: outcome.payout, outcome: savedOutcome, repeated: false };
    });
    return res.json({ ok: true, gameId: "pizza-yam", ...response });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false, message: error.status ? error.message : "تعذر تنفيذ الجولة",
      ...(Number.isSafeInteger(error.currentCoins) ? { coins: error.currentCoins } : {})
    });
  } finally { await session.endSession(); }
});
module.exports = router;
