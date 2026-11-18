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
const engine = require("../game-engines/rocket-crash");

const router = express.Router();
router.use(requireAuth, requireGameEnabled);

const MAX_MULTIPLIER = 100;
const validKey = key => /^[A-Za-z0-9_-]{16,80}$/.test(key);
const fail = (message, status) => Object.assign(new Error(message), { status });
const currentMultiplier = (round, now = Date.now()) => Math.min(
  MAX_MULTIPLIER,
  engine.multiplierAt(new Date(round.outcome.startAt).getTime(), now)
);

async function readRoundState(userId, requestedRoundId) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const filter = { userId, gameId: "rocket-crash", status: "accepted" };
      if (requestedRoundId) filter.roundId = requestedRoundId;
      const round = await GameRound.findOne(filter).sort({ createdAt: -1 }).session(session);
      const user = await User.findById(userId).session(session).select("coins");
      if (!user) throw fail("الحساب غير موجود", 404);
      if (!round) {
        result = { active: false, coins: user.coins };
        return;
      }

      const now = Date.now();
      const startAt = new Date(round.outcome.startAt).getTime();
      if (now >= startAt) {
        const multiplier = currentMultiplier(round, now);
        if (multiplier >= Number(round.outcome.crashAtMultiplier)) {
          round.status = "lost";
          round.outcome.crashedAt = new Date(now);
          round.markModified("outcome");
          await round.save({ session });
          result = { active: false, crashed: true, roundId: round.roundId,
            coins: user.coins, multiplier };
          return;
        }
        result = { active: true, roundId: round.roundId, bet: round.bet,
          phase: "fly", startAt, multiplier, coins: user.coins };
        return;
      }
      result = { active: true, roundId: round.roundId, bet: round.bet,
        phase: "wait", startAt, multiplier: 1, coins: user.coins };
    });
    const recent = await GameRound.find({
      userId, gameId: "rocket-crash", status: { $in: ["settled", "lost", "cancelled"] }
    }).sort({ settledAt: -1, createdAt: -1 }).limit(10)
      .select("roundId bet payout status outcome.crashAtMultiplier outcome.cashoutMultiplier settledAt")
      .lean();
    result.results = recent.map(round => ({
      roundId: round.roundId,
      status: round.status,
      bet: Number(round.bet) || 0,
      payout: Number(round.payout) || 0,
      multiplier: Number(round.outcome && (round.outcome.cashoutMultiplier || round.outcome.crashAtMultiplier)) || 1,
      settledAt: round.settledAt || null
    }));
    return result;
  } finally {
    await session.endSession();
  }
}

router.get("/rocket-crash/state", async (req, res) => {
  try {
    const result = await readRoundState(req.auth.sub, null);
    return res.json({ ok: true, gameId: "rocket-crash", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false,
      message: error.status ? error.message : "تعذر قراءة حالة الجولة" });
  }
});

router.get("/rocket-crash/:roundId/state", async (req, res) => {
  try {
    const result = await readRoundState(req.auth.sub, String(req.params.roundId));
    return res.json({ ok: true, gameId: "rocket-crash", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false,
      message: error.status ? error.message : "تعذر قراءة حالة الجولة" });
  }
});

router.post("/rocket-crash/start", async (req, res) => {
  const bet = Number(req.body && req.body.bet);
  const key = String(req.get("idempotency-key") || "");
  if (!validKey(key)) return res.status(400).json({ ok: false, message: "معرّف الجولة مطلوب" });
  try { engine.validateBet(bet); }
  catch (error) { return res.status(error.status || 400).json({ ok: false, message: error.message }); }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await GameRound.findOne({ idempotencyKey: key }).session(session);
      if (prior) {
        if (String(prior.userId) !== req.auth.sub || prior.gameId !== "rocket-crash" ||
            Number(prior.outcome && prior.outcome.requestedBet) !== bet) {
          throw fail("معرّف الجولة مستخدم لطلب مختلف", 409);
        }
        const user = await User.findById(req.auth.sub).session(session).select("coins");
        if (!user) throw fail("الحساب غير موجود", 404);
        result = { roundId: prior.roundId, bet: prior.bet, coins: user.coins,
          status: prior.status, startAt: new Date(prior.outcome.startAt).getTime(), repeated: true };
        return;
      }

      const user = await User.findOne({ _id: req.auth.sub, status: "active" })
        .session(session).select("coins");
      if (!user) throw fail("الحساب غير موجود أو غير نشط", 404);
      const activeRound = await GameRound.findOne({
        userId: user._id, gameId: "rocket-crash", status: "accepted"
      }).session(session);
      if (activeRound) throw fail("لديك جولة صاروخ لم تنتهِ بعد", 409);
      if (user.coins < bet) throw fail("رصيدك غير كافٍ", 409);

      const now = Date.now();
      const startAt = new Date(now + engine.START_DELAY_MS);
      const crashAtMultiplier = Math.min(MAX_MULTIPLIER, engine.generateCrashPoint());
      const roundId = crypto.randomUUID();

      user.coins -= bet;
      await WalletTransaction.create([{
        from: user._id, amount: bet, type: "game_bet",
        description: "رهان الصاروخ", idempotencyKey: key + "_bet"
      }], { session });
      await user.save({ session });
      await Wallet.updateOne({ userId: user._id }, { $set: { balance: user.coins } },
        { upsert: true, session });

      const [round] = await GameRound.create([{
        userId: user._id, gameId: "rocket-crash", roundId, idempotencyKey: key,
        bet, payout: 0, status: "accepted",
        outcome: { requestedBet: bet, startedAt: new Date(now), startAt, crashAtMultiplier }
      }], { session });
      result = { roundId: round.roundId, bet, coins: user.coins,
        status: round.status, startAt: startAt.getTime(), repeated: false };
    });
    return res.json({ ok: true, gameId: "rocket-crash", ...result });
  } catch (error) {
    if (error && error.code === 11000) {
      try {
        const prior = await GameRound.findOne({ idempotencyKey: key }).lean();
        if (prior && String(prior.userId) === req.auth.sub &&
            prior.gameId === "rocket-crash" && Number(prior.outcome && prior.outcome.requestedBet) === bet) {
          const user = await User.findById(req.auth.sub).select("coins").lean();
          if (user) return res.json({ ok: true, gameId: "rocket-crash",
            roundId: prior.roundId, bet: prior.bet, coins: user.coins, status: prior.status,
            startAt: new Date(prior.outcome.startAt).getTime(), repeated: true });
        }
        return res.status(409).json({ ok: false, message: "معرّف الجولة مستخدم بالفعل" });
      } catch (_) {
        return res.status(503).json({ ok: false, message: "تعذر التحقق من نتيجة الجولة، أعد المحاولة بنفس المعرّف" });
      }
    }
    return res.status(error.status || 500).json({ ok: false,
      message: error.status ? error.message : "تعذر بدء جولة الصاروخ" });
  } finally {
    await session.endSession();
  }
});

async function cashout(req, res) {
  const key = String(req.get("idempotency-key") || "");
  const roundId = String(req.params.roundId || (req.body && req.body.roundId) || "");
  if (!validKey(key) || !roundId) {
    return res.status(400).json({ ok: false, message: "بيانات السحب غير مكتملة" });
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const round = await GameRound.findOne({
        roundId, userId: req.auth.sub, gameId: "rocket-crash"
      }).session(session);
      if (!round) throw fail("الجولة غير موجودة", 404);

      if (round.outcome.cashoutKey) {
        if (round.outcome.cashoutKey !== key) throw fail("تم السحب بالفعل بمفتاح مختلف", 409);
        const user = await User.findById(req.auth.sub).session(session).select("coins");
        if (!user) throw fail("الحساب غير موجود", 404);
        result = { roundId, status: round.status, payout: round.payout,
          coins: user.coins, multiplier: round.outcome.cashoutMultiplier, repeated: true };
        return;
      }
      if (round.status !== "accepted") throw fail("الجولة انتهت ولا يمكن السحب", 409);

      const now = Date.now();
      const startAt = new Date(round.outcome.startAt).getTime();
      if (now < startAt) throw fail("لم يبدأ الصاروخ بعد", 409);
      const multiplier = currentMultiplier(round, now);
      if (multiplier >= Number(round.outcome.crashAtMultiplier)) {
        round.status = "lost";
        round.outcome.crashedAt = new Date(now);
        round.markModified("outcome");
        await round.save({ session });
        const user = await User.findById(req.auth.sub).session(session).select("coins");
        result = { roundId, status: "lost", payout: 0, coins: user ? user.coins : 0,
          multiplier, crashed: true };
        return;
      }

      const payout = Math.floor(round.bet * multiplier);
      if (!Number.isSafeInteger(payout) || payout < 1) throw fail("قيمة الجائزة غير صالحة", 409);
      const user = await User.findOne({ _id: req.auth.sub, status: "active" })
        .session(session).select("coins");
      if (!user) throw fail("الحساب غير موجود أو غير نشط", 404);
      user.coins += payout;
      await WalletTransaction.create([{
        to: user._id, amount: payout, type: "game_reward",
        description: "سحب الصاروخ", idempotencyKey: round.roundId + "_cashout"
      }], { session });
      await user.save({ session });
      await Wallet.updateOne({ userId: user._id }, { $set: { balance: user.coins } },
        { upsert: true, session });

      round.status = "settled";
      round.payout = payout;
      round.outcome.cashoutKey = key;
      round.outcome.cashoutMultiplier = multiplier;
      round.outcome.cashoutAt = new Date(now);
      round.markModified("outcome");
      round.settledAt = new Date(now);
      await round.save({ session });
      result = { roundId, status: "settled", payout, coins: user.coins,
        multiplier, repeated: false };
    });
    if (result.status === "lost") {
      return res.status(409).json({ ok: false, message: "انفجر الصاروخ قبل السحب",
        gameId: "rocket-crash", ...result });
    }
    return res.json({ ok: true, gameId: "rocket-crash", ...result });
  } catch (error) {
    if (error && error.code === 11000) {
      try {
        const round = await GameRound.findOne({ roundId, userId: req.auth.sub, gameId: "rocket-crash" }).lean();
        if (round && round.outcome && round.outcome.cashoutKey === key) {
          const user = await User.findById(req.auth.sub).select("coins").lean();
          if (user) return res.json({ ok: true, gameId: "rocket-crash",
            roundId, status: round.status, payout: round.payout, coins: user.coins,
            multiplier: round.outcome.cashoutMultiplier, repeated: true });
        }
        return res.status(409).json({ ok: false, message: "تم تنفيذ السحب أو استخدام معرّف مختلف" });
      } catch (_) {
        return res.status(503).json({ ok: false, message: "تعذر التحقق من نتيجة السحب، أعد المحاولة بنفس المعرّف" });
      }
    }
    return res.status(error.status || 500).json({ ok: false,
      message: error.status ? error.message : "تعذر تنفيذ السحب" });
  } finally {
    await session.endSession();
  }
}
router.post(["/rocket-crash/cashout", "/rocket-crash/:roundId/cashout"], cashout);

router.post("/rocket-crash/cancel", async (req, res) => {
  const key = String(req.get("idempotency-key") || "");
  const roundId = String(req.body && req.body.roundId || "");
  if (!validKey(key) || !roundId) {
    return res.status(400).json({ ok: false, message: "بيانات الإلغاء غير مكتملة" });
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const round = await GameRound.findOne({
        roundId, userId: req.auth.sub, gameId: "rocket-crash"
      }).session(session);
      if (!round) throw fail("الجولة غير موجودة", 404);
      if (round.status === "cancelled") {
        if (round.outcome.cancelKey !== key) throw fail("تم إلغاء الجولة بالفعل", 409);
        const user = await User.findById(req.auth.sub).session(session).select("coins");
        result = { roundId, coins: user ? user.coins : 0, cancelled: true, repeated: true };
        return;
      }
      if (round.status !== "accepted" ||
          Date.now() >= new Date(round.outcome.startAt).getTime()) {
        throw fail("لا يمكن إلغاء الجولة بعد بدء الصاروخ", 409);
      }
      const user = await User.findOne({ _id: req.auth.sub, status: "active" })
        .session(session).select("coins");
      if (!user) throw fail("الحساب غير موجود أو غير نشط", 404);
      user.coins += round.bet;
      await WalletTransaction.create([{
        to: user._id, amount: round.bet, type: "game_refund",
        description: "استرداد رهان الصاروخ الملغي",
        idempotencyKey: round.roundId + "_cancel"
      }], { session });
      await user.save({ session });
      await Wallet.updateOne({ userId: user._id }, { $set: { balance: user.coins } },
        { upsert: true, session });
      round.status = "cancelled";
      round.payout = round.bet;
      round.settledAt = new Date();
      round.outcome.cancelKey = key;
      round.markModified("outcome");
      await round.save({ session });
      result = { roundId, coins: user.coins, cancelled: true, repeated: false };
    });
    return res.json({ ok: true, gameId: "rocket-crash", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false,
      message: error.status ? error.message : "تعذر إلغاء الرهان" });
  } finally {
    await session.endSession();
  }
});

module.exports = router;
