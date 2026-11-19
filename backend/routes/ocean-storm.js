"use strict";

const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const GameRound = require("../models/GameRound");
const requireAuth = require("../middleware/requireAuth");
const requireGameEnabled = require("../middleware/requireGameEnabled");
const oceanStorm = require("../game-engines/ocean-storm");

const router = express.Router();
router.use(requireAuth);
router.use(requireGameEnabled);

router.post("/ocean-storm/spin", async (req, res) => {
  const bet = Number(req.body && req.body.bet);
  const ante = req.body && req.body.ante === true;
  const buyFeature = req.body && req.body.buyFeature === true;
  const key = String(req.get("idempotency-key") || "");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) {
    return res.status(400).json({ ok: false, message: "معرّف الجولة مطلوب" });
  }
  let game;
  try {
    game = oceanStorm.play({ bet, ante, buyFeature });
  } catch (error) {
    return res.status(error.status || 400).json({ ok: false, message: error.message });
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await GameRound.findOne({ idempotencyKey: key }).session(session);
      if (prior) {
        if (String(prior.userId) !== req.auth.sub || prior.gameId !== "ocean-storm" ||
            Number(prior.outcome && prior.outcome.requestedBet) !== bet ||
            !!(prior.outcome && prior.outcome.ante) !== ante ||
            !!(prior.outcome && prior.outcome.buyFeature) !== buyFeature) {
          throw Object.assign(new Error("معرّف الجولة مستخدم لطلب مختلف"), { status: 409 });
        }
        const current = await User.findById(req.auth.sub).session(session).select("coins");
        if (!current) throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
        result = { roundId: prior.roundId, coins: current.coins, bet: prior.bet,
          payout: prior.payout, grid: prior.outcome.grid, steps: prior.outcome.steps || [], freeSpinRounds: prior.outcome.freeSpinRounds || [], outcome: prior.outcome, repeated: true };
        return;
      }

      const user = await User.findOne({ _id: req.auth.sub, status: "active" })
        .session(session).select("coins");
      if (!user) throw Object.assign(new Error("الحساب غير موجود أو غير نشط"), { status: 404 });
      if (user.coins < game.cost) throw Object.assign(new Error("رصيدك غير كافٍ"), { status: 409 });

      user.coins -= game.cost;
      await WalletTransaction.create([{
        from: user._id, amount: game.cost, type: "game_bet",
        description: "رهان عاصفة المحيط", idempotencyKey: key + "_bet"
      }], { session });

      if (game.payout > 0) {
        user.coins += game.payout;
        await WalletTransaction.create([{
          to: user._id, amount: game.payout, type: "game_reward",
          description: "مكسب عاصفة المحيط", idempotencyKey: key + "_win"
        }], { session });
      }
      await user.save({ session });
      await Wallet.updateOne({ userId: user._id }, { $set: { balance: user.coins } }, { upsert: true, session });

      const roundId = crypto.randomUUID();
      const outcome = { ...game.outcome, grid: game.grid, steps: game.steps, freeSpinRounds: game.freeSpinRounds, requestedBet: bet, ante, buyFeature };
      const [round] = await GameRound.create([{
        userId: user._id, gameId: "ocean-storm", roundId, idempotencyKey: key,
        bet: game.cost, payout: game.payout,
        status: game.payout > 0 ? "settled" : "lost", outcome, settledAt: new Date()
      }], { session });
      result = { roundId: round.roundId, coins: user.coins, bet: game.cost,
        payout: game.payout, grid: game.grid, steps: game.steps, freeSpinRounds: game.freeSpinRounds, outcome, repeated: false };
    });
    return res.json({ ok: true, gameId: "ocean-storm", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false, message: error.status ? error.message : "تعذر تنفيذ الجولة"
    });
  } finally {
    await session.endSession();
  }
});

module.exports = router;
