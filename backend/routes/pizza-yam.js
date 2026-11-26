"use strict";
const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const PizzaYamRound = require("../models/PizzaYamRound");
const pizzaYam = require("../game-engines/pizza-yam");
const router = express.Router();
router.use(require("../middleware/requireAuth"));

async function ensureRound(clock) {
  const startsAt = new Date(clock.roundStartsAt);
  const betEndsAt = new Date(clock.betEndsAt);
  const spinEndsAt = new Date(clock.spinEndsAt);
  const endsAt = new Date(clock.roundEndsAt);
  const outcome = pizzaYam.play({ bets: Array(8).fill(0) });
  try {
    return await PizzaYamRound.findOneAndUpdate(
      { roundNumber: clock.round },
      { $setOnInsert: { roundNumber: clock.round, startsAt, betEndsAt, spinEndsAt, endsAt, outcome: {
        targetIndex: outcome.targetIndex, group: outcome.group, winningIndices: outcome.winningIndices
      }, bets: [] } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error && error.code === 11000) return PizzaYamRound.findOne({ roundNumber: clock.round });
    throw error;
  }
}
function publicState(clock, round) {
  const reveal = clock.phase === "result";
  return {
    ok: true, gameId: "pizza-yam", roundNumber: clock.round, phase: clock.phase,
    serverTime: clock.serverTime, roundStartsAt: clock.roundStartsAt,
    betEndsAt: clock.betEndsAt, spinEndsAt: clock.spinEndsAt, roundEndsAt: clock.roundEndsAt,
    remainingMs: clock.remainingMs,
    outcome: reveal ? round.outcome : null
  };
}
router.get("/pizza-yam/state", async (req, res, next) => {
  try {
    const clock = pizzaYam.getRoundClock();
    const round = await ensureRound(clock);
    const userBets = round.bets.filter(item => String(item.userId) === req.auth.sub);
    const user = await User.findById(req.auth.sub).select("coins");
    if (!user) return res.status(404).json({ ok: false, message: "الحساب غير موجود" });
    const userSettlement = {
      hasBets: userBets.length > 0,
      settled: userBets.length > 0 && userBets.every(item => item.settled === true),
      totalBet: userBets.reduce((sum, item) => sum + Number(item.totalBet || 0), 0),
      payout: userBets.reduce((sum, item) => sum + Number(item.payout || 0), 0)
    };
    return res.json({ ...publicState(clock, round), coins: user.coins, userSettlement,
      bets: userBets.reduce((sum, item) => sum.map((v, i) => v + item.bets[i]), Array(8).fill(0)) });
  } catch (error) { return next(error); }
});

router.post("/pizza-yam/bet", async (req, res) => {
  const key = String(req.get("idempotency-key") || "");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key))
    return res.status(400).json({ ok: false, message: "معرّف الرهان مطلوب" });
  let normalized;
  try { normalized = pizzaYam.normalizeBets(req.body || {}); }
  catch (error) { return res.status(error.status || 400).json({ ok: false, message: error.message }); }
  const clock = pizzaYam.getRoundClock();
  if (clock.phase !== "bet") return res.status(409).json({ ok: false, message: "انتهى وقت استقبال الرهانات" });
  const session = await mongoose.startSession();
  try {
    let response;
    await session.withTransaction(async () => {
      const prior = await WalletTransaction.findOne({ idempotencyKey: key + "_bet" }).session(session);
      if (prior) {
        if (String(prior.from) !== req.auth.sub || prior.amount !== normalized.totalBet)
          throw Object.assign(new Error("معرّف الرهان مستخدم لطلب مختلف"), { status: 409 });
        const user = await User.findById(req.auth.sub).session(session).select("coins");
        response = { coins: user.coins, bet: normalized.totalBet, repeated: true };
        return;
      }
      const round = await PizzaYamRound.findOne({ roundNumber: clock.round }).session(session);
      if (!round || Date.now() >= new Date(round.betEndsAt).getTime())
        throw Object.assign(new Error("انتهى وقت استقبال الرهانات"), { status: 409 });
      const user = await User.findOneAndUpdate(
        { _id: req.auth.sub, status: "active", coins: { $gte: normalized.totalBet } },
        { $inc: { coins: -normalized.totalBet } },
        { new: true, session, projection: { coins: 1 } }
      );
      if (!user) throw Object.assign(new Error("الرصيد غير كافٍ أو الحساب غير نشط"), { status: 409 });
      await Wallet.updateOne({ userId: user._id }, { $set: { balance: user.coins } }, { upsert: true, session });
      await WalletTransaction.create([{
        from: user._id, amount: normalized.totalBet, type: "game_bet",
        description: "رهان بيتزا يم - الجولة " + clock.round,
        idempotencyKey: key + "_bet"
      }], { session });
      const changed = await PizzaYamRound.updateOne(
        { _id: round._id, betEndsAt: { $gt: new Date() }, "bets.idempotencyKey": { $ne: key } },
        { $push: { bets: { userId: user._id, idempotencyKey: key, bets: normalized.bets, totalBet: normalized.totalBet, settled: false, payout: 0 } } },
        { session }
      );
      if (!changed.modifiedCount) throw Object.assign(new Error("تعذر تسجيل الرهان؛ انتهى الوقت أو تكرر الطلب"), { status: 409 });
      response = { coins: user.coins, bet: normalized.totalBet, repeated: false };
    });
    const freshClock = pizzaYam.getRoundClock();
    const round = await PizzaYamRound.findOne({ roundNumber: freshClock.round });
    const userBets = round ? round.bets.filter(item => String(item.userId) === req.auth.sub) : [];
    const aggregateBets = userBets.reduce((sum, item) => sum.map((v, i) => v + item.bets[i]), Array(8).fill(0));
    return res.json({ ok: true, gameId: "pizza-yam", ...response, ...publicState(freshClock, round), bets: aggregateBets });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر تسجيل الرهان" });
  } finally { await session.endSession(); }
});

// Temporary compatibility: old one-shot requests are rejected rather than settling
// an immediate client-triggered outcome outside the shared timed round.
router.post("/pizza-yam/spin", (_req, res) =>
  res.status(410).json({ ok: false, message: "تم تغيير طريقة اللعب: سجّل الرهان أثناء وقت الرهان وانتظر نتيجة الجولة" })
);
module.exports = router;
