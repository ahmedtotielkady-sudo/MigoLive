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
const validKey = key => /^[A-Za-z0-9_-]{16,80}$/.test(key);
const fail = (message, status) => Object.assign(new Error(message), { status });
const MAX_MULTIPLIER = 100;
const currentMultiplier = round => Math.min(MAX_MULTIPLIER,
  engine.multiplierAt(new Date(round.outcome.startAt).getTime(), Date.now()));

router.post("/rocket-crash/start", async (req,res) => {
  const bet = Number(req.body && req.body.bet);
  const key = String(req.get("idempotency-key") || "");
  if (!validKey(key)) return res.status(400).json({ ok:false, message:"معرّف الجولة مطلوب" });
  try { engine.validateBet(bet); }
  catch (error) { return res.status(error.status || 400).json({ ok:false, message:error.message }); }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await GameRound.findOne({ idempotencyKey:key }).session(session);
      if (prior) {
        if (String(prior.userId) !== req.auth.sub || prior.gameId !== "rocket-crash" ||
            Number(prior.outcome && prior.outcome.requestedBet) !== bet) {
          throw fail("معرّف الجولة مستخدم لطلب مختلف", 409);
        }
        const user = await User.findById(req.auth.sub).session(session).select("coins");
        if (!user) throw fail("الحساب غير موجود", 404);
        result = { roundId:prior.roundId, bet:prior.bet, coins:user.coins,
          status:prior.status, phase:"wait", startAt:new Date(prior.outcome.startAt).getTime(), repeated:true };
        return;
      }
      const user = await User.findOne({ _id:req.auth.sub, status:"active" })
        .session(session).select("coins");
      if (!user) throw fail("الحساب غير موجود أو غير نشط", 404);
      if (user.coins < bet) throw fail("رصيدك غير كافٍ", 409);
      user.coins -= bet;
      await WalletTransaction.create([{
        from:user._id, amount:bet, type:"game_bet", description:"رهان الصاروخ",
        idempotencyKey:key + "_bet"
      }], { session });
      await user.save({ session });
      await Wallet.updateOne({ userId:user._id }, { $set:{ balance:user.coins } }, { upsert:true, session });

      const now = Date.now();
      const startAt = new Date(now + engine.START_DELAY_MS);
      const crashAtMultiplier = Math.min(MAX_MULTIPLIER, engine.generateCrashPoint());
      const roundId = crypto.randomUUID();
      const [round] = await GameRound.create([{
        userId:user._id, gameId:"rocket-crash", roundId, idempotencyKey:key,
        bet, payout:0, status:"accepted",
        outcome:{ requestedBet:bet, startedAt:new Date(now), startAt, crashAtMultiplier }
      }], { session });
      result = { roundId:round.roundId, bet, coins:user.coins, status:round.status,
        phase:"wait", startAt:startAt.getTime(), repeated:false };
    });
    return res.json({ ok:true, gameId:"rocket-crash", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok:false,
      message:error.status ? error.message : "تعذر بدء جولة الصاروخ" });
  } finally { await session.endSession(); }
});

router.get("/rocket-crash/state", async (req,res) => {\n  try {\n    const round = await GameRound.findOne({ userId:req.auth.sub, gameId:"rocket-crash", status:"accepted" }).sort({ createdAt:-1 }).lean();\n    if (!round) return res.json({ ok:true, gameId:"rocket-crash", active:false });\n    const now=Date.now(), startAt=new Date(round.outcome.startAt).getTime();\n    const phase=now<startAt ? "wait" : "fly";\n    const multiplier=phase==="wait" ? 1 : currentMultiplier(round);\n    return res.json({ ok:true, gameId:"rocket-crash", active:true, roundId:round.roundId, bet:round.bet, phase, startAt, multiplier });\n  } catch (_) { return res.status(500).json({ ok:false, message:"تعذر قراءة حالة الجولة" }); }\n});\n\nrouter.get("/rocket-crash/:roundId/state", async (req,res) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const round = await GameRound.findOne({
        roundId:req.params.roundId, userId:req.auth.sub, gameId:"rocket-crash"
      }).session(session);
      if (!round) throw fail("الجولة غير موجودة", 404);
      if (round.status !== "accepted") {
        result = { roundId:round.roundId, status:round.status, payout:round.payout,
          multiplier:round.outcome.cashoutMultiplier || null, crashed:round.status === "lost" };
        return;
      }
      const now = Date.now();
      if (now < new Date(round.outcome.startAt).getTime()) {
        result = { roundId:round.roundId, status:"waiting", multiplier:1, crashed:false,
          startsInMs:new Date(round.outcome.startAt).getTime() - now };
        return;
      }
      const multiplier = currentMultiplier(round);
      if (multiplier >= Number(round.outcome.crashAtMultiplier)) {
        round.status = "lost";
        round.outcome.crashedAt = new Date(now);
        round.markModified("outcome");
        await round.save({ session });
        result = { roundId:round.roundId, status:"lost", multiplier,
          crashed:true, payout:0 };
        return;
      }
      result = { roundId:round.roundId, status:"accepted", multiplier, crashed:false };
    });
    return res.json({ ok:true, gameId:"rocket-crash", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok:false,
      message:error.status ? error.message : "تعذر قراءة حالة الجولة" });
  } finally { await session.endSession(); }
});

router.post(["/rocket-crash/cashout", "/rocket-crash/:roundId/cashout"], async (req,res) => {
  const cashoutKey = String(req.get("idempotency-key") || "");
  if (!validKey(cashoutKey)) return res.status(400).json({ ok:false, message:"معرّف السحب مطلوب" });
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const round = await GameRound.findOne({
        roundId:req.params.roundId, userId:req.auth.sub, gameId:"rocket-crash"
      }).session(session);
      if (!round) throw fail("الجولة غير موجودة", 404);
      if (round.outcome.cashoutKey) {
        if (round.outcome.cashoutKey !== cashoutKey) throw fail("تم السحب بالفعل بمفتاح مختلف", 409);
        const user = await User.findById(req.auth.sub).session(session).select("coins");
        if (!user) throw fail("الحساب غير موجود", 404);
        result = { roundId:round.roundId, status:round.status, payout:round.payout,
          coins:user.coins, multiplier:round.outcome.cashoutMultiplier, repeated:true };
        return;
      }
      if (round.status !== "accepted") throw fail("الجولة انتهت ولا يمكن السحب", 409);
      const now = Date.now();
      if (now < new Date(round.outcome.startAt).getTime()) throw fail("لم يبدأ الصاروخ بعد", 409);
      const multiplier = currentMultiplier(round);
      if (multiplier >= Number(round.outcome.crashAtMultiplier)) {
        round.status = "lost";
        round.outcome.crashedAt = new Date(now);
        round.markModified("outcome");
        await round.save({ session });
        result = { roundId:round.roundId, status:"lost", payout:0, multiplier, crashed:true };
        return;
      }
      const payout = Math.floor(round.bet * multiplier);
      if (!Number.isSafeInteger(payout) || payout < 1) throw fail("قيمة الجائزة غير صالحة", 409);
      const user = await User.findOne({ _id:req.auth.sub, status:"active" })
        .session(session).select("coins");
      if (!user) throw fail("الحساب غير موجود أو غير نشط", 404);
      user.coins += payout;
      await WalletTransaction.create([{
        to:user._id, amount:payout, type:"game_reward", description:"سحب الصاروخ",
        idempotencyKey:round.roundId + "_cashout"
      }], { session });
      await user.save({ session });
      await Wallet.updateOne({ userId:user._id }, { $set:{ balance:user.coins } }, { upsert:true, session });
      round.status = "settled";
      round.payout = payout;
      round.outcome.cashoutKey = cashoutKey;
      round.outcome.cashoutMultiplier = multiplier;
      round.outcome.cashoutAt = new Date(now);
      round.markModified("outcome");
      round.settledAt = new Date(now);
      await round.save({ session });
      result = { roundId:round.roundId, status:"settled", payout, coins:user.coins,
        multiplier, repeated:false };
    });
    if (result.status === "lost") return res.status(409).json({ ok:false,
      message:"انفجر الصاروخ قبل السحب", gameId:"rocket-crash", ...result });
    return res.json({ ok:true, gameId:"rocket-crash", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok:false,
      message:error.status ? error.message : "تعذر تنفيذ السحب" });
  } finally { await session.endSession(); }
});

module.exports = router;
