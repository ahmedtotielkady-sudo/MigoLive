"use strict";
const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const GameRound = require("../models/GameRound");
const requireAuth = require("../middleware/requireAuth");
const wheel = require("../game-engines/wheel-animals");
const fruit = require("../game-engines/fruit-luck");

const router = express.Router();
router.use(requireAuth);
const validKey = key => /^[A-Za-z0-9_-]{16,80}$/.test(key);
const fail = (message, status) => Object.assign(new Error(message), { status });

function parseRequest(gameId, body) {
  if (gameId === "wheel-animals") {
    const bets = body && body.bets;
    if (!Array.isArray(bets) || bets.length !== 8 ||
        bets.some(value => !Number.isSafeInteger(value) || value < 0 || value > 5000000 || value % 500 !== 0)) {
      throw fail("توزيع رهانات الحيوانات غير صحيح", 400);
    }
    const totalBet = bets.reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(totalBet) || totalBet < 1 || totalBet > 5000000) {
      throw fail("إجمالي الرهان خارج الحد المسموح", 400);
    }
    return { requestedBets: bets, totalBet };
  }
  const bets = body && body.bets;
  if (!bets || typeof bets !== "object" || Array.isArray(bets) ||
      Object.keys(bets).some(key => !["m", "77", "o"].includes(key)) ||
      ["m", "77", "o"].some(key => !Number.isSafeInteger(bets[key] ?? 0) ||
        (bets[key] ?? 0) < 0 || (bets[key] ?? 0) % 10 !== 0)) {
    throw fail("توزيع رهانات الفواكه غير صحيح", 400);
  }
  const normalized = { m: bets.m || 0, "77": bets["77"] || 0, o: bets.o || 0 };
  const totalBet = normalized.m + normalized["77"] + normalized.o;
  if (!Number.isSafeInteger(totalBet) || totalBet < 1 || totalBet > 5000000) {
    throw fail("إجمالي الرهان خارج الحد المسموح", 400);
  }
  return { requestedBets: normalized, totalBet };
}

async function settle(req, res, gameId, label, engine) {
  const key = String(req.get("idempotency-key") || "");
  if (!validKey(key)) return res.status(400).json({ ok:false, message:"معرّف الجولة مطلوب" });
  let parsed;
  try { parsed = parseRequest(gameId, req.body || {}); }
  catch (error) { return res.status(error.status || 400).json({ ok:false, message:error.message }); }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await GameRound.findOne({ idempotencyKey:key }).session(session);
      if (prior) {
        if (String(prior.userId) !== req.auth.sub || prior.gameId !== gameId ||
            JSON.stringify(prior.outcome && prior.outcome.requestedBets) !== JSON.stringify(parsed.requestedBets)) {
          throw fail("معرّف الجولة مستخدم لطلب مختلف", 409);
        }
        const current = await User.findById(req.auth.sub).session(session).select("coins");
        if (!current) throw fail("الحساب غير موجود", 404);
        result = { roundId:prior.roundId, coins:current.coins, bet:prior.bet,
          payout:prior.payout, outcome:prior.outcome, repeated:true };
        return;
      }
      const user = await User.findOne({ _id:req.auth.sub, status:"active" })
        .session(session).select("coins");
      if (!user) throw fail("الحساب غير موجود أو غير نشط", 404);
      if (user.coins < parsed.totalBet) throw fail("رصيدك غير كافٍ", 409);

      const gameResult = engine.play(parsed.requestedBets);
      const payout = Number(gameResult.payout);
      if (!Number.isSafeInteger(payout) || payout < 0) throw fail("قيمة الجائزة غير صحيحة", 500);
      user.coins -= parsed.totalBet;
      await WalletTransaction.create([{
        from:user._id, amount:parsed.totalBet, type:"game_bet",
        description:"رهان " + label, idempotencyKey:key + "_bet"
      }], { session });
      if (payout > 0) {
        user.coins += payout;
        await WalletTransaction.create([{
          to:user._id, amount:payout, type:"game_reward",
          description:"جائزة " + label, idempotencyKey:key + "_win"
        }], { session });
      }
      await user.save({ session });
      await Wallet.updateOne({ userId:user._id }, { $set:{ balance:user.coins } }, { upsert:true, session });

      const roundId = crypto.randomUUID();
      const outcome = { ...gameResult, requestedBets:parsed.requestedBets };
      const [round] = await GameRound.create([{
        userId:user._id, gameId, roundId, idempotencyKey:key,
        bet:parsed.totalBet, payout,
        status:payout > 0 ? "settled" : "lost",
        outcome, settledAt:new Date()
      }], { session });
      result = { roundId:round.roundId, coins:user.coins, bet:parsed.totalBet,
        payout, outcome, repeated:false };
    });
    return res.json({ ok:true, gameId, ...result });
  } catch (error) {
    if (error && error.code === 11000) {
      try {
        const prior = await GameRound.findOne({ idempotencyKey:key }).lean();
        if (prior && String(prior.userId) === req.auth.sub && prior.gameId === gameId &&
            JSON.stringify(prior.outcome && prior.outcome.requestedBets) === JSON.stringify(parsed.requestedBets)) {
          const current = await User.findById(req.auth.sub).select("coins").lean();
          if (current) return res.json({ ok:true, gameId, roundId:prior.roundId,
            coins:current.coins, bet:prior.bet, payout:prior.payout, outcome:prior.outcome, repeated:true });
        }
        return res.status(409).json({ ok:false, message:"معرّف الجولة مستخدم بالفعل" });
      } catch (_lookupError) {
        return res.status(503).json({ ok:false, message:"تعذر التحقق من نتيجة الجولة، أعد المحاولة بنفس المعرّف" });
      }
    }
    return res.status(error.status || 500).json({ ok:false,
      message:error.status ? error.message : "تعذر تنفيذ الجولة" });
  } finally { await session.endSession(); }
}

router.post("/wheel-animals/spin", (req,res) =>
  settle(req,res,"wheel-animals","عجلة الحيوانات",wheel));
router.post("/fruit-luck/spin", (req,res) =>
  settle(req,res,"fruit-luck","حظ الفواكه",fruit));

module.exports = router;
