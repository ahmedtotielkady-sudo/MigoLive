"use strict";
const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const GameRound = require("../models/GameRound");
const requireAuth = require("../middleware/requireAuth");
const engine = require("../game-engines/big-warrior");
const router = express.Router();
router.use(requireAuth);

router.post("/big-warrior/play", async (req, res) => {
  const bet = Number(req.body && req.body.bet);
  const pick = String(req.body && req.body.pick || "");
  const key = String(req.get("idempotency-key") || "");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) return res.status(400).json({ ok:false, message:"معرّف الجولة مطلوب" });
  if (!Number.isSafeInteger(bet) || !engine.BETS.includes(bet)) return res.status(400).json({ ok:false, message:"قيمة الرهان غير مسموح بها" });
  if (!["lion","tiger","draw"].includes(pick)) return res.status(400).json({ ok:false, message:"اختيار غير صحيح" });
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await GameRound.findOne({ idempotencyKey:key }).session(session);
      if (prior) {
        if (String(prior.userId)!==req.auth.sub || prior.gameId!=="big-warrior" ||
            Number(prior.outcome && prior.outcome.requestedBet)!==bet ||
            String(prior.outcome && prior.outcome.pick)!==pick) {
          throw Object.assign(new Error("معرّف الجولة مستخدم لطلب مختلف"), { status:409 });
        }
        const current = await User.findById(req.auth.sub).session(session).select("coins");
        if (!current) throw Object.assign(new Error("الحساب غير موجود"), { status:404 });
        result = { roundId:prior.roundId, coins:current.coins, bet:prior.bet, payout:prior.payout,
          winner:prior.outcome.winner, won:!!prior.outcome.won, repeated:true };
        return;
      }
      const user = await User.findOne({ _id:req.auth.sub, status:"active" }).session(session).select("coins");
      if (!user) throw Object.assign(new Error("الحساب غير موجود أو غير نشط"), { status:404 });
      if (user.coins < bet) throw Object.assign(new Error("رصيدك غير كافٍ"), { status:409 });
      const outcome = engine.play({ bet, pick });
      user.coins -= bet;
      await WalletTransaction.create([{ from:user._id, amount:bet, type:"game_bet",
        description:"رهان المحارب الكبير", idempotencyKey:key+"_bet" }], { session });
      if (outcome.payout > 0) {
        user.coins += outcome.payout;
        await WalletTransaction.create([{ to:user._id, amount:outcome.payout, type:"game_reward",
          description:"مكسب المحارب الكبير", idempotencyKey:key+"_win" }], { session });
      }
      await user.save({ session });
      await Wallet.updateOne({ userId:user._id }, { $set:{ balance:user.coins } }, { upsert:true, session });
      const roundId = crypto.randomUUID();
      const saved = { ...outcome, pick, requestedBet:bet };
      const [round] = await GameRound.create([{ userId:user._id, gameId:"big-warrior", roundId,
        idempotencyKey:key, bet, payout:outcome.payout, status:outcome.payout>0?"settled":"lost",
        outcome:saved, settledAt:new Date() }], { session });
      result = { roundId:round.roundId, coins:user.coins, bet, payout:outcome.payout,
        winner:outcome.winner, won:outcome.won, repeated:false };
    });
    return res.json({ ok:true, gameId:"big-warrior", ...result });
  } catch (error) {
    if (error && error.code === 11000) {
      try {
        const prior = await GameRound.findOne({ idempotencyKey:key }).lean();
        if (prior) {
          if (String(prior.userId)!==req.auth.sub || prior.gameId!=="big-warrior" ||
              Number(prior.outcome && prior.outcome.requestedBet)!==bet ||
              String(prior.outcome && prior.outcome.pick)!==pick) {
            return res.status(409).json({ ok:false, message:"معرّف الجولة مستخدم لطلب مختلف" });
          }
          const current = await User.findById(req.auth.sub).select("coins").lean();
          if (current) return res.json({ ok:true, gameId:"big-warrior", roundId:prior.roundId,
            coins:current.coins, bet:prior.bet, payout:prior.payout,
            winner:prior.outcome.winner, won:!!prior.outcome.won, repeated:true });
        }
      } catch (_lookupError) {
        return res.status(503).json({ ok:false, message:"تعذر التحقق من نتيجة الجولة، أعد المحاولة بنفس المعرّف" });
      }
    }
    return res.status(error.status || 500).json({ ok:false,
      message:error.status ? error.message : "تعذر تنفيذ الجولة" });
  } finally { await session.endSession(); }
});
module.exports = router;
