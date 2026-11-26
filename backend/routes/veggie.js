const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const VeggieRound = require("../models/VeggieRound");
const veggie = require("../game-engines/veggie");

const router = express.Router();
const EPOCH = Date.UTC(2026, 0, 1);
function roundNumberAt(now) {
  return Math.max(0, Math.floor((now.getTime() - EPOCH) / (veggie.CYCLE_SECONDS * 1000)));
}
async function getRound(number, now) {
  const startsAt = new Date(EPOCH + number * veggie.CYCLE_SECONDS * 1000);
  const round = await VeggieRound.findOneAndUpdate(
    { roundNumber: number },
    { $setOnInsert: {
      roundNumber: number, roundId: crypto.randomUUID(), startsAt,
      betCloseAt: new Date(startsAt.getTime() + veggie.BET_SECONDS * 1000),
      spinEndAt: new Date(startsAt.getTime() + (veggie.BET_SECONDS + veggie.SPIN_SECONDS) * 1000),
      resultAt: new Date(startsAt.getTime() + veggie.CYCLE_SECONDS * 1000),
      outcome: veggie.createOutcome(), bets: []
    } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return round;
}
function publicRound(round, now, playerBet) {
  const elapsed = Math.max(0, (now.getTime() - round.startsAt.getTime()) / 1000);
  const phase = elapsed < veggie.BET_SECONDS ? "bet" :
    elapsed < veggie.BET_SECONDS + veggie.SPIN_SECONDS ? "spin" : "result";
  const showOutcome = phase !== "bet";
  return {
    roundId: round.roundId, roundNumber: round.roundNumber, phase,
    startsAt: round.startsAt.getTime(), betCloseAt: round.betCloseAt.getTime(),
    spinEndAt: round.spinEndAt.getTime(), resultAt: round.resultAt.getTime(),
    serverNow: now.getTime(), outcome: showOutcome ? round.outcome : null,
    playerBet: playerBet ? { amounts: playerBet.amounts, totalBet: playerBet.totalBet,
      payout: playerBet.payout, settled: playerBet.settled } : null
  };
}

router.get("/state", async (req, res) => {
  try {
    const now = new Date();
    const number = roundNumberAt(now);
    const current = await getRound(number, now);
    const session = await mongoose.startSession();
    let coins = 0;
    let previousPayout = 0;
    try {
      await session.withTransaction(async () => {
        const user = await User.findOne({ _id: req.auth.sub, status: "active" }).session(session).select("coins");
        if (!user) throw Object.assign(new Error("الحساب غير موجود أو غير نشط"), { status: 404 });
        const pendingRounds = await VeggieRound.find({
          "bets.userId": user._id, resultAt: { $lte: now }
        }).session(session);
        for (const oldRound of pendingRounds) {
          const bet = oldRound.bets.find(item => String(item.userId) === String(user._id));
          if (!bet || bet.settled) continue;
          const payout = veggie.payoutFor(bet.amounts, oldRound.outcome);
          bet.payout = payout;
          bet.settled = true;
          bet.settledAt = now;
          previousPayout += payout;
          if (payout > 0) {
            user.coins += payout;
            await WalletTransaction.create([{
              to: user._id, amount: payout, type: "game_reward",
              description: "مكسب لعبة خضار", idempotencyKey: "veggie_" + oldRound.roundId + "_" + String(user._id) + "_win"
            }], { session });
          }
          await oldRound.save({ session });
        }
        if (previousPayout > 0) {
          await user.save({ session });
          await Wallet.updateOne({ userId: user._id }, { $set: { balance: user.coins } }, { upsert: true, session });
        }
        coins = user.coins;
      });
    } finally { await session.endSession(); }
    const playerBet = current.bets.find(item => String(item.userId) === String(req.auth.sub)) || null;
    return res.json({ ok: true, gameId: "veggie", coins, ...publicRound(current, now, playerBet),
      previousPayout });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر تحميل الجولة" });
  }
});

router.post("/bet", async (req, res) => {
  let parsed;
  try { parsed = veggie.validateBets(req.body && req.body.amounts); }
  catch (error) { return res.status(error.status || 400).json({ ok: false, message: error.message }); }
  const roundId = String(req.body && req.body.roundId || "");
  if (!roundId) return res.status(400).json({ ok: false, message: "رقم الجولة مطلوب" });
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const now = new Date();
      const round = await VeggieRound.findOne({ roundId }).session(session);
      if (!round) throw Object.assign(new Error("الجولة غير موجودة"), { status: 404 });
      if (now < round.startsAt || now >= round.betCloseAt) {
        throw Object.assign(new Error("انتهى وقت الرهان لهذه الجولة"), { status: 409 });
      }
      const user = await User.findOne({ _id: req.auth.sub, status: "active" }).session(session).select("coins");
      if (!user) throw Object.assign(new Error("الحساب غير موجود أو غير نشط"), { status: 404 });
      const index = round.bets.findIndex(item => String(item.userId) === String(user._id));
      const old = index >= 0 ? round.bets[index] : null;
      const oldTotal = old ? old.totalBet : 0;
      const additional = parsed.total - oldTotal;
      if (additional > user.coins) throw Object.assign(new Error("رصيدك غير كافٍ"), { status: 409 });
      if (additional < 0) throw Object.assign(new Error("لا يمكن تقليل الرهان بعد تأكيده"), { status: 409 });
      if (index >= 0) {
        old.amounts = parsed.amounts;
        old.totalBet = parsed.total;
      } else {
        round.bets.push({ userId: user._id, amounts: parsed.amounts, totalBet: parsed.total, settled: false });
      }
      if (additional > 0) {
        user.coins -= additional;
        await WalletTransaction.create([{
          from: user._id, amount: additional, type: "game_bet",
          description: "رهان لعبة خضار", idempotencyKey: "veggie_" + round.roundId + "_" + String(user._id) + "_bet_" + parsed.total
        }], { session });
      }
      await round.save({ session });
      await user.save({ session });
      await Wallet.updateOne({ userId: user._id }, { $set: { balance: user.coins } }, { upsert: true, session });
      result = { roundId: round.roundId, coins: user.coins, bet: parsed.total,
        payout: 0, outcome: { accepted: true, amounts: parsed.amounts }, repeated: index >= 0 };
    });
    return res.json({ ok: true, gameId: "veggie", ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false,
      message: error.status ? error.message : "تعذر تسجيل الرهان" });
  } finally { await session.endSession(); }
});

module.exports = router;
