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

router.post("/pizza-yam/spin", async (req, res) => {
  const key = String(req.get("idempotency-key") || "");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) {
    return res.status(400).json({ ok: false, message: "معرّف الجولة مطلوب" });
  }
  let game;
  try { game = pizzaYam.play(req.body && req.body.bets); }
  catch (error) { return res.status(error.status || 400).json({ ok: false, message: error.message }); }

  const clock = pizzaYam.currentRound();
  // Only accept the result submission during the result window. The server's
  // clock and RNG decide the outcome; client input contains bets only.
  if (clock.offset < pizzaYam.BET_SECONDS + pizzaYam.SPIN_SECONDS ||
      clock.offset > pizzaYam.CYCLE_SECONDS + 2) {
    return res.status(409).json({ ok: false, message: "لم تنتهِ الجولة بعد أو انتهت مهلة اعتمادها" });
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await GameRound.findOne({ idempotencyKey: key }).session(session);
      if (prior) {
        if (String(prior.userId) !== req.auth.sub || prior.gameId !== "pizza-yam" ||
            JSON.stringify(prior.outcome && prior.outcome.requestedBets) !== JSON.stringify(game.bets)) {
          throw Object.assign(new Error("معرّف الجولة مستخدم لطلب مختلف"), { status: 409 });
        }
        const current = await User.findById(req.auth.sub).session(session).select("coins");
        if (!current) throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
        result = { roundId: prior.roundId, coins: current.coins, bet: prior.bet,
          payout: prior.payout, outcome: prior.outcome, repeated: true };
        return;
      }
      const user = await User.findOne({ _id: req.auth.sub, status: "active" })
        .session(session).select("coins");
      if (!user) throw Object.assign(new Error("الحساب غير موجود أو غير نشط"), { status: 404 });
      if (user.coins < game.totalBet) {
        throw Object.assign(new Error("رصيدك غير كافٍ"), { status: 409, currentCoins: user.coins });
      }
      user.coins -= game.totalBet;
      await WalletTransaction.create([{
        from: user._id, amount: game.totalBet, type: "game_bet",
        description: "رهان لعبة بيتزا يم", idempotencyKey: key + "_bet"
      }], { session });
      if (game.payout > 0) {
        user.coins += game.payout;
        await WalletTransaction.create([{
          to: user._id, amount: game.payout, type: "game_reward",
          description: "مكسب لعبة بيتزا يم", idempotencyKey: key + "_win"
        }], { session });
      }
      await user.save({ session });
      await Wallet.updateOne({ userId: user._id }, { $set: { balance: user.coins } },
        { upsert: true, session });
      const roundId = crypto.randomUUID();
      const outcome = { ...game.outcome, requestedBets: game.bets, net: game.net };
      const [round] = await GameRound.create([{
        userId: user._id, gameId: "pizza-yam", roundId, idempotencyKey: key,
        bet: game.totalBet, payout: game.payout,
        status: game.payout > 0 ? "settled" : "lost", outcome, settledAt: new Date()
      }], { session });
      result = { roundId: round.roundId, coins: user.coins, bet: game.totalBet,
        payout: game.payout, outcome, repeated: false };
    });
    return res.json({ ok: true, gameId: "pizza-yam", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false, message: error.status ? error.message : "تعذر اعتماد نتيجة بيتزا يم",
      ...(Number.isSafeInteger(error.currentCoins) ? { coins: error.currentCoins } : {})
    });
  } finally { await session.endSession(); }
});

module.exports = router;
