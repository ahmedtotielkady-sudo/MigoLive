"use strict";

const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const GameRound = require("../models/GameRound");
const requireAuth = require("../middleware/requireAuth");
const engine = require("../game-engines/rocket-crash");

const router = express.Router();
router.use(requireAuth);

function requestKey(req) {
  return String(req.get("idempotency-key") || "");
}
function validKey(key) {
  return /^[A-Za-z0-9_-]{16,80}$/.test(key);
}
function fail(message, status = 409) {
  return Object.assign(new Error(message), { status });
}
async function walletBalance(userId, session) {
  const user = await User.findById(userId).session(session).select("coins");
  if (!user) throw fail("الحساب غير موجود", 404);
  return user.coins;
}

router.post("/rocket-crash/start", async (req, res) => {
  const bet = Number(req.body && req.body.bet);
  const key = requestKey(req);
  if (!validKey(key)) return res.status(400).json({ ok: false, message: "معرّف الجولة مطلوب" });
  try { engine.validateBet(bet); }
  catch (error) { return res.status(error.status || 400).json({ ok: false, message: error.message }); }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await GameRound.findOne({ idempotencyKey: key }).session(session);
      if (prior) {
        if (String(prior.userId) !== req.auth.sub || prior.gameId !== "rocket-crash" || prior.bet !== bet) {
          throw fail("معرّف الجولة مستخدم لطلب مختلف", 409);
        }
        const coins = await walletBalance(req.auth.sub, session);
        result = { roundId: prior.roundId, coins, bet: prior.bet, startAt: prior.outcome.startAt, repeated: true };
        return;
      }

      const active = await GameRound.findOne({
        userId: req.auth.sub, gameId: "rocket-crash", status: "accepted"
      }).session(session);
      if (active) throw fail("لديك جولة جارية بالفعل", 409);

      const user = await User.findOne({ _id: req.auth.sub, status: "active" })
        .session(session).select("coins");
      if (!user) throw fail("الحساب غير موجود أو غير نشط", 404);
      if (user.coins < bet) throw fail("رصيدك غير كافٍ", 409);

      user.coins -= bet;
      await user.save({ session });
      await Wallet.updateOne(
        { userId: user._id }, { $set: { balance: user.coins } }, { upsert: true, session }
      );
      await WalletTransaction.create([{
        from: user._id, amount: bet, type: "game_bet",
        description: "رهان لعبة الصاروخ", idempotencyKey: key + "_bet"
      }], { session });

      const startAt = Date.now() + engine.START_DELAY_MS;
      const roundId = crypto.randomUUID();
      const [round] = await GameRound.create([{
        userId: user._id, gameId: "rocket-crash", roundId, idempotencyKey: key,
        bet, payout: 0, status: "accepted",
        outcome: { startAt, crashAt: engine.generateCrashPoint(), requestedBet: bet },
        settledAt: null
      }], { session });
      result = { roundId: round.roundId, coins: user.coins, bet, startAt, repeated: false };
    });
    return res.json({ ok: true, gameId: "rocket-crash", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false, message: error.status ? error.message : "تعذر بدء الجولة"
    });
  } finally { await session.endSession(); }
});

router.post("/rocket-crash/state", async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const round = await GameRound.findOne({
        userId: req.auth.sub, gameId: "rocket-crash", status: "accepted"
      }).sort({ createdAt: -1 }).session(session);
      const user = await User.findById(req.auth.sub).session(session).select("coins");
      if (!user) throw fail("الحساب غير موجود", 404);
      if (!round) {
        result = { active: false, crashed: false, coins: user.coins };
        return;
      }
      const now = Date.now(), startAt = Number(round.outcome.startAt);
      if (now < startAt) {
        result = { active: true, phase: "wait", multiplier: 1, startAt, roundId: round.roundId, coins: user.coins };
        return;
      }
      const multiplier = engine.multiplierAt(startAt, now);
      const crashAt = Number(round.outcome.crashAt);
      if (multiplier >= crashAt) {
        round.status = "lost";
        round.settledAt = new Date(now);
        round.outcome = { ...round.outcome, crashedAt: now };
        await round.save({ session });
        result = { active: false, crashed: true, multiplier: crashAt, roundId: round.roundId, coins: user.coins };
        return;
      }
      result = { active: true, phase: "fly", multiplier, roundId: round.roundId, coins: user.coins };
    });
    return res.json({ ok: true, gameId: "rocket-crash", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر تحديث الجولة" });
  } finally { await session.endSession(); }
});

router.post("/rocket-crash/cashout", async (req, res) => {
  const roundId = String(req.body && req.body.roundId || "");
  const key = requestKey(req);
  if (!roundId || roundId.length > 80 || !validKey(key)) {
    return res.status(400).json({ ok: false, message: "بيانات السحب غير صحيحة" });
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const round = await GameRound.findOne({
        userId: req.auth.sub, gameId: "rocket-crash", roundId
      }).session(session);
      if (!round) throw fail("الجولة غير موجودة", 404);
      if (round.status === "settled" && round.outcome.cashoutKey === key) {
        const coins = await walletBalance(req.auth.sub, session);
        result = { roundId, coins, payout: round.payout, multiplier: round.outcome.cashoutMultiplier, repeated: true };
        return;
      }
      if (round.status !== "accepted") throw fail("انتهت الجولة بالفعل", 409);

      const now = Date.now(), startAt = Number(round.outcome.startAt);
      if (now < startAt) throw fail("لم يبدأ الصاروخ بعد", 409);
      const multiplier = engine.multiplierAt(startAt, now);
      const crashAt = Number(round.outcome.crashAt);
      if (multiplier >= crashAt) {
        round.status = "lost";
        round.settledAt = new Date(now);
        round.outcome = { ...round.outcome, crashedAt: now };
        await round.save({ session });
        const coins = await walletBalance(req.auth.sub, session);
        result = { roundId, coins, payout: 0, crashed: true, multiplier: crashAt, repeated: false };
        return;
      }

      const payout = Math.floor(round.bet * multiplier);
      const user = await User.findOneAndUpdate(
        { _id: req.auth.sub, status: "active" },
        { $inc: { coins: payout } },
        { new: true, session, projection: { coins: 1 } }
      );
      if (!user) throw fail("الحساب غير موجود أو غير نشط", 404);
      await Wallet.updateOne(
        { userId: user._id }, { $set: { balance: user.coins } }, { upsert: true, session }
      );
      await WalletTransaction.create([{
        to: user._id, amount: payout, type: "game_reward",
        description: "مكسب لعبة الصاروخ", idempotencyKey: key + "_win"
      }], { session });
      round.status = "settled";
      round.payout = payout;
      round.settledAt = new Date(now);
      round.outcome = { ...round.outcome, cashoutKey: key, cashoutMultiplier: multiplier };
      await round.save({ session });
      result = { roundId, coins: user.coins, payout, multiplier, crashed: false, repeated: false };
    });
    return res.json({ ok: true, gameId: "rocket-crash", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر سحب الأرباح" });
  } finally { await session.endSession(); }
});

router.post("/rocket-crash/cancel", async (req, res) => {
  const roundId = String(req.body && req.body.roundId || "");
  const key = requestKey(req);
  if (!roundId || roundId.length > 80 || !validKey(key)) {
    return res.status(400).json({ ok: false, message: "بيانات الإلغاء غير صحيحة" });
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const round = await GameRound.findOne({
        userId: req.auth.sub, gameId: "rocket-crash", roundId
      }).session(session);
      if (!round) throw fail("الجولة غير موجودة", 404);
      if (round.status === "cancelled" && round.outcome.cancelKey === key) {
        const coins = await walletBalance(req.auth.sub, session);
        result = { roundId, coins, refunded: round.bet, repeated: true };
        return;
      }
      if (round.status !== "accepted" || Date.now() >= Number(round.outcome.startAt)) {
        throw fail("لا يمكن إلغاء الرهان بعد بدء الجولة", 409);
      }
      const user = await User.findOneAndUpdate(
        { _id: req.auth.sub, status: "active" },
        { $inc: { coins: round.bet } },
        { new: true, session, projection: { coins: 1 } }
      );
      if (!user) throw fail("الحساب غير موجود أو غير نشط", 404);
      await Wallet.updateOne(
        { userId: user._id }, { $set: { balance: user.coins } }, { upsert: true, session }
      );
      await WalletTransaction.create([{
        to: user._id, amount: round.bet, type: "game_reward",
        description: "استرداد رهان لعبة الصاروخ", idempotencyKey: key + "_refund"
      }], { session });
      round.status = "cancelled";
      round.settledAt = new Date();
      round.outcome = { ...round.outcome, cancelKey: key };
      await round.save({ session });
      result = { roundId, coins: user.coins, refunded: round.bet, repeated: false };
    });
    return res.json({ ok: true, gameId: "rocket-crash", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر إلغاء الرهان" });
  } finally { await session.endSession(); }
});

module.exports = router;
