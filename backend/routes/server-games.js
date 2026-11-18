"use strict";
const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const GameRound = require("../models/GameRound");
const requireAuth = require("../middleware/requireAuth");
const engine = require("../game-engines/server-games");

const router = express.Router();
router.use(requireAuth);
const validKey = key => /^[A-Za-z0-9_-]{16,80}$/.test(key);
const fail = (message, status) => Object.assign(new Error(message), { status });

async function settleSpin(req, res, gameId, label) {
  const bet = Number(req.body && req.body.bet);
  const key = String(req.get("idempotency-key") || "");
  if (!validKey(key)) return res.status(400).json({ ok:false, message:"معرّف الجولة مطلوب" });
  if (!Number.isSafeInteger(bet) || bet < engine.MIN_BET || bet > engine.MAX_BET) {
    return res.status(400).json({ ok:false, message:"قيمة الرهان غير مسموح بها" });
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await GameRound.findOne({ idempotencyKey:key }).session(session);
      if (prior) {
        if (String(prior.userId) !== req.auth.sub || prior.gameId !== gameId ||
            Number(prior.outcome && prior.outcome.requestedBet) !== bet) {
          throw fail("مفتاح الجولة مستخدم لطلب مختلف", 409);
        }
        const current = await User.findById(req.auth.sub).session(session).select("coins");
        if (!current) throw fail("الحساب غير موجود", 404);
        result = { roundId:prior.roundId, coins:current.coins, bet:prior.bet,
          payout:prior.payout, outcome:prior.outcome, repeated:true };
        return;
      }
      const user = await User.findOne({ _id:req.auth.sub, status:"active" }).session(session).select("coins");
      if (!user) throw fail("الحساب غير موجود أو غير نشط", 404);
      if (user.coins < bet) throw fail("رصيدك غير كافٍ", 409);
      const outcome = engine.spin(gameId, bet);
      user.coins -= bet;
      if (outcome.payout > 0) user.coins += outcome.payout;
      await WalletTransaction.create([{
        from:user._id, amount:bet, type:"game_bet", description:"رهان " + label,
        idempotencyKey:key + "_bet"
      }], { session });
      if (outcome.payout > 0) await WalletTransaction.create([{
        to:user._id, amount:outcome.payout, type:"game_reward", description:"جائزة " + label,
        idempotencyKey:key + "_win"
      }], { session });
      await user.save({ session });
      await Wallet.updateOne({ userId:user._id }, { $set:{ balance:user.coins } }, { upsert:true, session });
      const roundId = crypto.randomUUID();
      const [round] = await GameRound.create([{
        userId:user._id, gameId, roundId, idempotencyKey:key, bet, payout:outcome.payout,
        status:outcome.payout > 0 ? "settled" : "lost",
        outcome:{ ...outcome, requestedBet:bet }, settledAt:new Date()
      }], { session });
      result = { roundId:round.roundId, coins:user.coins, bet, payout:outcome.payout,
        outcome:round.outcome, repeated:false };
    });
    return res.json({ ok:true, gameId, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok:false,
      message:error.status ? error.message : "تعذر تنفيذ الجولة" });
  } finally { await session.endSession(); }
}

router.post("/wheel-animals/spin", (req,res) => settleSpin(req,res,"wheel-animals","عجلة الحيوانات"));
router.post("/fruit-luck/spin", (req,res) => settleSpin(req,res,"fruit-luck","حظ الفواكه"));

router.post("/rocket-crash/start", async (req,res) => {
  const bet = Number(req.body && req.body.bet);
  const key = String(req.get("idempotency-key") || "");
  if (!validKey(key)) return res.status(400).json({ ok:false, message:"معرّف الجولة مطلوب" });
  if (!Number.isSafeInteger(bet) || bet < engine.MIN_BET || bet > engine.MAX_BET) {
    return res.status(400).json({ ok:false, message:"قيمة الرهان غير مسموح بها" });
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await GameRound.findOne({ idempotencyKey:key }).session(session);
      if (prior) {
        if (String(prior.userId) !== req.auth.sub || prior.gameId !== "rocket-crash" ||
            Number(prior.outcome && prior.outcome.requestedBet) !== bet) {
          throw fail("مفتاح الجولة مستخدم لطلب مختلف",409);
        }
        const user = await User.findById(req.auth.sub).session(session).select("coins");
        if (!user) throw fail("الحساب غير موجود",404);
        result = { roundId:prior.roundId, bet:prior.bet, coins:user.coins,
          status:prior.status, startedAt:prior.outcome.startedAt, repeated:true };
        return;
      }
      const user = await User.findOne({ _id:req.auth.sub, status:"active" }).session(session).select("coins");
      if (!user) throw fail("الحساب غير موجود أو غير نشط",404);
      if (user.coins < bet) throw fail("رصيدك غير كافٍ",409);
      user.coins -= bet;
      await WalletTransaction.create([{
        from:user._id, amount:bet, type:"game_bet", description:"رهان الصاروخ",
        idempotencyKey:key + "_bet"
      }], { session });
      await user.save({ session });
      await Wallet.updateOne({ userId:user._id }, { $set:{ balance:user.coins } }, { upsert:true, session });
      const startedAt = new Date();
      const hiddenCrashAt = engine.crashPoint();
      const roundId = crypto.randomUUID();
      const [round] = await GameRound.create([{
        userId:user._id, gameId:"rocket-crash", roundId, idempotencyKey:key, bet,
        payout:0, status:"accepted",
        outcome:{ requestedBet:bet, startedAt, crashAtMultiplier:hiddenCrashAt }
      }], { session });
      result = { roundId:round.roundId, bet, coins:user.coins, status:round.status, startedAt, repeated:false };
    });
    return res.json({ ok:true, gameId:"rocket-crash", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok:false,
      message:error.status ? error.message : "تعذر بدء جولة الصاروخ" });
  } finally { await session.endSession(); }
});

router.get("/rocket-crash/:roundId/state", async (req,res) => {
  try {
    const round = await GameRound.findOne({ roundId:req.params.roundId, userId:req.auth.sub, gameId:"rocket-crash" });
    if (!round) return res.status(404).json({ ok:false, message:"الجولة غير موجودة" });
    if (round.status !== "accepted") return res.json({ ok:true, roundId:round.roundId,
      status:round.status, payout:round.payout, multiplier:round.outcome.cashoutMultiplier || null });
    const now = Date.now();
    const elapsedMs = Math.max(0, now - new Date(round.outcome.startedAt).getTime());
    const multiplier = engine.rocketMultiplier(elapsedMs);
    const crashed = multiplier >= Number(round.outcome.crashAtMultiplier);
    if (crashed) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const current = await GameRound.findOne({ _id:round._id, status:"accepted" }).session(session);
          if (current) { current.status = "lost"; current.outcome.crashedAt = new Date(now); await current.save({ session }); }
        });
      } finally { await session.endSession(); }
      return res.json({ ok:true, roundId:round.roundId, status:"lost", crashed:true, multiplier:null });
    }
    return res.json({ ok:true, roundId:round.roundId, status:"accepted", crashed:false, multiplier });
  } catch (_error) { return res.status(500).json({ ok:false, message:"تعذر قراءة حالة الجولة" }); }
});

router.post("/rocket-crash/:roundId/cashout", async (req,res) => {
  const cashoutKey = String(req.get("idempotency-key") || "");
  if (!validKey(cashoutKey)) return res.status(400).json({ ok:false, message:"معرّف السحب مطلوب" });
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const round = await GameRound.findOne({ roundId:req.params.roundId, userId:req.auth.sub, gameId:"rocket-crash" }).session(session);
      if (!round) throw fail("الجولة غير موجودة",404);
      if (round.outcome.cashoutKey) {
        if (round.outcome.cashoutKey !== cashoutKey) throw fail("تم السحب بالفعل بمفتاح مختلف",409);
        const user = await User.findById(req.auth.sub).session(session).select("coins");
        result = { roundId:round.roundId, status:round.status, payout:round.payout,
          coins:user.coins, multiplier:round.outcome.cashoutMultiplier, repeated:true };
        return;
      }
      if (round.status !== "accepted") throw fail("انفجرت الجولة أو انتهت ولا يمكن السحب",409);
      const now = Date.now();
      const elapsedMs = Math.max(0, now - new Date(round.outcome.startedAt).getTime());
      const multiplier = engine.rocketMultiplier(elapsedMs);
      if (multiplier >= Number(round.outcome.crashAtMultiplier)) {
        round.status = "lost";
        round.outcome.crashedAt = new Date(now);
        await round.save({ session });
        result = { roundId:round.roundId, status:"lost", payout:0, crashed:true };
        return;
      }
      const payout = Math.floor(round.bet * multiplier);
      const user = await User.findOne({ _id:req.auth.sub, status:"active" }).session(session).select("coins");
      if (!user) throw fail("الحساب غير موجود أو غير نشط",404);
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
      round.settledAt = new Date(now);
      await round.save({ session });
      result = { roundId:round.roundId, status:"settled", payout, coins:user.coins,
        multiplier, repeated:false };
    });
    if (result.status === "lost") return res.status(409).json({ ok:false, message:"انفجر الصاروخ قبل السحب", ...result });
    return res.json({ ok:true, gameId:"rocket-crash", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok:false,
      message:error.status ? error.message : "تعذر تنفيذ السحب" });
  } finally { await session.endSession(); }
});

module.exports = router;
