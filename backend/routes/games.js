const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const GameRound = require("../models/GameRound");
const GameState = require("../models/GameState");
const requireAuth = require("../middleware/requireAuth");
const slot777 = require("../game-engines/slot-777");

const router = express.Router();
router.use(requireAuth);

async function recoverDuplicateRound(key, userId, gameId, requestHash) {
  const [prior, user] = await Promise.all([
    GameRound.findOne({ idempotencyKey: key }).lean(),
    User.findById(userId).select("coins").lean()
  ]);
  if (!prior || !user || String(prior.userId) !== String(userId) ||
      prior.gameId !== gameId || !prior.requestHash || prior.requestHash !== requestHash) return null;
  return {
    roundId: prior.roundId, coins: user.coins, bet: prior.bet,
    payout: prior.payout, outcome: prior.outcome, repeated: true
  };
}


// Only this route is live initially. Other game IDs remain unavailable until
// their original payout rules have been ported and independently tested.
router.post("/slot-777/spin", async (req, res) => {
  const bet = Number(req.body && req.body.bet);
  const key = String(req.get("idempotency-key") || "");
  const requestHash = crypto.createHash("sha256").update(JSON.stringify({ gameId: "slot-777", userId: String(req.auth.sub), bet })).digest("hex");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) {
    return res.status(400).json({ ok: false, message: "معرّف الجولة مطلوب" });
  }
  if (!Number.isSafeInteger(bet) || !slot777.MULTIPLIERS.some(m => bet === slot777.BASE * m)) {
    return res.status(400).json({ ok: false, message: "قيمة الرهان غير مسموح بها" });
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await GameRound.findOne({ idempotencyKey: key }).session(session);
      if (prior) {
        if (String(prior.userId) !== req.auth.sub || prior.gameId !== "slot-777" || Number(prior.outcome && prior.outcome.requestedBet) !== bet) {
          throw Object.assign(new Error("معرّف الجولة مستخدم لطلب مختلف"), { status: 409 });
        }
        const current = await User.findById(req.auth.sub).session(session).select("coins");
        if (!current) throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
        result = { roundId: prior.roundId, coins: current.coins, bet: prior.bet, payout: prior.payout,
          outcome: prior.outcome, freeSpin: !!(prior.outcome && prior.outcome.freeSpin),
          freeSpinsRemaining: Number(prior.outcome && prior.outcome.freeSpinsRemaining) || 0, repeated: true };
        return;
      }

      const user = await User.findOne({ _id: req.auth.sub, status: "active" })
        .session(session).select("coins");
      if (!user) throw Object.assign(new Error("الحساب غير موجود أو غير نشط"), { status: 404 });

      let state = await GameState.findOne({ userId: user._id, gameId: "slot-777" }).session(session);
      if (!state) {
        state = new GameState({ userId: user._id, gameId: "slot-777", freeSpins: 0 });
      }
      const freeSpin = state.freeSpins > 0;
      const actualBet = freeSpin ? 0 : bet;
      if (!freeSpin && user.coins < bet) {
        throw Object.assign(new Error("رصيدك غير كافٍ"), { status: 409 });
      }

      const outcome = slot777.play({ bet, freeSpin });
      if (actualBet > 0) {
        user.coins -= actualBet;
        await WalletTransaction.create([{
          from: user._id, amount: actualBet, type: "game_bet",
          description: "رهان سلوت 777", idempotencyKey: key + "_bet"
        }], { session });
      } else {
        state.freeSpins -= 1;
      }
      if (outcome.win > 0) {
        user.coins += outcome.win;
        await WalletTransaction.create([{
          to: user._id, amount: outcome.win, type: "game_reward",
          description: "مكسب سلوت 777", idempotencyKey: key + "_win"
        }], { session });
      }
      state.freeSpins += outcome.freeSpins;
      state.updatedAt = new Date();
      await state.save({ session });
      await user.save({ session });
      await Wallet.updateOne({ userId: user._id }, { $set: { balance: user.coins } }, { upsert: true, session });

      const roundId = crypto.randomUUID();
      const [round] = await GameRound.create([{
        userId: user._id, gameId: "slot-777", roundId, idempotencyKey: key, requestHash,
        bet: actualBet, payout: outcome.win,
        status: outcome.win > 0 ? "settled" : "lost",
        outcome: { grid: outcome.grid, bonus: outcome.bonus, freeSpinsAwarded: outcome.freeSpins, freeSpinsRemaining: state.freeSpins, hits: outcome.hits, requestedBet: bet, freeSpin },
        settledAt: new Date()
      }], { session });
      result = { roundId: round.roundId, coins: user.coins, bet: actualBet, payout: outcome.win,
        outcome: round.outcome, freeSpin, freeSpinsRemaining: state.freeSpins, repeated: false };
    });
    return res.json({ ok: true, gameId: "slot-777", ...result });
  } catch (error) {
    if (error && error.code === 11000) {
      try {
        const replay = await recoverDuplicateRound(key, req.auth.sub, slot-777, requestHash);
        if (replay) return res.json({ ok: true, gameId: slot-777, ...replay });
        return res.status(409).json({ ok: false, message: "معرّف الجولة مستخدم لطلب مختلف" });
      } catch (_) {
        return res.status(503).json({ ok: false, message: "تعذر تأكيد نتيجة الجولة؛ أعد المحاولة بنفس المعرّف" });
      }
    }
    return res.status(error.status || 500).json({
      ok: false, message: error.status ? error.message : "تعذر تنفيذ الجولة",
      ...(Number.isSafeInteger(error.currentCoins) ? { coins: error.currentCoins } : {})
    });
  } finally {
    await session.endSession();
  }
});


const wheelAnimals = require("../game-engines/wheel-animals");

router.post("/wheel-animals/spin", async (req, res) => {
  const bets = req.body && req.body.bets;
  const key = String(req.get("idempotency-key") || "");
  const requestHash = crypto.createHash("sha256").update(JSON.stringify({ gameId: "wheel-animals", userId: String(req.auth.sub), bets })).digest("hex");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) {
    return res.status(400).json({ ok: false, message: "معرّف الجولة مطلوب" });
  }
  let game;
  try { game = wheelAnimals.play(bets); }
  catch (error) { return res.status(error.status || 400).json({ ok: false, message: error.message }); }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await GameRound.findOne({ idempotencyKey: key }).session(session);
      if (prior) {
        const sameBets = JSON.stringify(prior.outcome && prior.outcome.requestedBets) === JSON.stringify(bets);
        if (String(prior.userId) !== req.auth.sub || prior.gameId !== "wheel-animals" || !sameBets) {
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
      if (user.coins < game.totalBet) throw Object.assign(new Error("رصيدك غير كافٍ"), { status: 409, currentCoins: user.coins });

      user.coins -= game.totalBet;
      await WalletTransaction.create([{
        from: user._id, amount: game.totalBet, type: "game_bet",
        description: "رهان عجلة الحيوانات", idempotencyKey: key + "_bet"
      }], { session });
      if (game.payout > 0) {
        user.coins += game.payout;
        await WalletTransaction.create([{
          to: user._id, amount: game.payout, type: "game_reward",
          description: "مكسب عجلة الحيوانات", idempotencyKey: key + "_win"
        }], { session });
      }
      await user.save({ session });
      await Wallet.updateOne({ userId: user._id }, { $set: { balance: user.coins } }, { upsert: true, session });

      const roundId = crypto.randomUUID();
      const outcome = { ...game, requestedBets: bets };
      const [round] = await GameRound.create([{
        userId: user._id, gameId: "wheel-animals", roundId, idempotencyKey: key, requestHash,
        bet: game.totalBet, payout: game.payout,
        status: game.payout > 0 ? "settled" : "lost", outcome, settledAt: new Date()
      }], { session });
      result = { roundId: round.roundId, coins: user.coins, bet: game.totalBet,
        payout: game.payout, outcome, repeated: false };
    });
    return res.json({ ok: true, gameId: "wheel-animals", ...result });
  } catch (error) {
    if (error && error.code === 11000) {
      try {
        const replay = await recoverDuplicateRound(key, req.auth.sub, wheel-animals, requestHash);
        if (replay) return res.json({ ok: true, gameId: wheel-animals, ...replay });
        return res.status(409).json({ ok: false, message: "معرّف الجولة مستخدم لطلب مختلف" });
      } catch (_) {
        return res.status(503).json({ ok: false, message: "تعذر تأكيد نتيجة الجولة؛ أعد المحاولة بنفس المعرّف" });
      }
    }
    return res.status(error.status || 500).json({
      ok: false, message: error.status ? error.message : "تعذر تنفيذ الجولة",
      ...(Number.isSafeInteger(error.currentCoins) ? { coins: error.currentCoins } : {})
    });
  } finally { await session.endSession(); }
});


const fruitLuck = require("../game-engines/fruit-luck");

router.post("/fruit-luck/spin", async (req, res) => {
  const bets = req.body && req.body.bets;
  const key = String(req.get("idempotency-key") || "");
  const requestHash = crypto.createHash("sha256").update(JSON.stringify({ gameId: "fruit-luck", userId: String(req.auth.sub), bets })).digest("hex");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) {
    return res.status(400).json({ ok: false, message: "معرّف الجولة مطلوب" });
  }
  let game;
  try { game = fruitLuck.play(bets); }
  catch (error) { return res.status(error.status || 400).json({ ok: false, message: error.message }); }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await GameRound.findOne({ idempotencyKey: key }).session(session);
      if (prior) {
        const sameBets = JSON.stringify(prior.outcome && prior.outcome.requestedBets) === JSON.stringify(game.requestedBets);
        if (String(prior.userId) !== req.auth.sub || prior.gameId !== "fruit-luck" || !sameBets) {
          throw Object.assign(new Error("معرّف الجولة مستخدم لطلب مختلف"), { status: 409 });
        }
        const current = await User.findById(req.auth.sub).session(session).select("coins");
        if (!current) throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
        result = { roundId: prior.roundId, coins: current.coins, bet: prior.bet,
          payout: prior.payout, outcome: prior.outcome, repeated: true };
        return;
      }

      const user = await User.findOne({ _id: req.auth.sub, status: "active" }).session(session).select("coins");
      if (!user) throw Object.assign(new Error("الحساب غير موجود أو غير نشط"), { status: 404 });
      if (user.coins < game.totalBet) throw Object.assign(new Error("رصيدك غير كافٍ"), { status: 409 });

      user.coins -= game.totalBet;
      await WalletTransaction.create([{
        from: user._id, amount: game.totalBet, type: "game_bet",
        description: "رهان فواكه الحظ", idempotencyKey: key + "_bet"
      }], { session });
      if (game.payout > 0) {
        user.coins += game.payout;
        await WalletTransaction.create([{
          to: user._id, amount: game.payout, type: "game_reward",
          description: "مكسب فواكه الحظ", idempotencyKey: key + "_win"
        }], { session });
      }
      await user.save({ session });
      await Wallet.updateOne({ userId: user._id }, { $set: { balance: user.coins } }, { upsert: true, session });

      const roundId = crypto.randomUUID();
      const outcome = { ...game };
      const [round] = await GameRound.create([{
        userId: user._id, gameId: "fruit-luck", roundId, idempotencyKey: key, requestHash,
        bet: game.totalBet, payout: game.payout,
        status: game.payout > 0 ? "settled" : "lost", outcome, settledAt: new Date()
      }], { session });
      result = { roundId: round.roundId, coins: user.coins, bet: game.totalBet,
        payout: game.payout, outcome, repeated: false };
    });
    return res.json({ ok: true, gameId: "fruit-luck", ...result });
  } catch (error) {
    if (error && error.code === 11000) {
      try {
        const replay = await recoverDuplicateRound(key, req.auth.sub, fruit-luck, requestHash);
        if (replay) return res.json({ ok: true, gameId: fruit-luck, ...replay });
        return res.status(409).json({ ok: false, message: "معرّف الجولة مستخدم لطلب مختلف" });
      } catch (_) {
        return res.status(503).json({ ok: false, message: "تعذر تأكيد نتيجة الجولة؛ أعد المحاولة بنفس المعرّف" });
      }
    }
    return res.status(error.status || 500).json({
      ok: false, message: error.status ? error.message : "تعذر تنفيذ الجولة"
    });
  } finally { await session.endSession(); }
});



const bigWarrior = require("../game-engines/big-warrior");

router.post("/big-warrior/fight", async (req, res) => {
  const bet = Number(req.body && req.body.bet);
  const pick = String(req.body && req.body.pick || "");
  const key = String(req.get("idempotency-key") || "");
  const requestHash = crypto.createHash("sha256").update(JSON.stringify({ gameId: "big-warrior", userId: String(req.auth.sub), bet, pick })).digest("hex");
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(key)) {
    return res.status(400).json({ ok: false, message: "معرّف الجولة مطلوب" });
  }
  try { bigWarrior.validate(bet, pick); }
  catch (error) { return res.status(error.status || 400).json({ ok: false, message: error.message }); }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const prior = await GameRound.findOne({ idempotencyKey: key }).session(session);
      if (prior) {
        if (String(prior.userId) !== req.auth.sub || prior.gameId !== "big-warrior" ||
            Number(prior.outcome && prior.outcome.requestedBet) !== bet ||
            String(prior.outcome && prior.outcome.pick) !== pick) {
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
      if (user.coins < bet) throw Object.assign(new Error("رصيدك غير كافٍ"), { status: 409 });

      const outcome = bigWarrior.play({ bet, pick });
      user.coins -= bet;
      await WalletTransaction.create([{
        from: user._id, amount: bet, type: "game_bet",
        description: "رهان المحارب الكبير", idempotencyKey: key + "_bet"
      }], { session });
      if (outcome.payout > 0) {
        user.coins += outcome.payout;
        await WalletTransaction.create([{
          to: user._id, amount: outcome.payout, type: "game_reward",
          description: "مكسب المحارب الكبير", idempotencyKey: key + "_win"
        }], { session });
      }
      await user.save({ session });
      await Wallet.updateOne({ userId: user._id }, { $set: { balance: user.coins } }, { upsert: true, session });
      const roundId = crypto.randomUUID();
      const [round] = await GameRound.create([{
        userId: user._id, gameId: "big-warrior", roundId, idempotencyKey: key, requestHash,
        bet, payout: outcome.payout,
        status: outcome.payout > 0 ? "settled" : "lost",
        outcome, settledAt: new Date()
      }], { session });
      result = { roundId: round.roundId, coins: user.coins, bet, payout: outcome.payout,
        outcome: round.outcome, repeated: false };
    });
    return res.json({ ok: true, gameId: "big-warrior", ...result });
  } catch (error) {
    if (error && error.code === 11000) {
      try {
        const replay = await recoverDuplicateRound(key, req.auth.sub, big-warrior, requestHash);
        if (replay) return res.json({ ok: true, gameId: big-warrior, ...replay });
        return res.status(409).json({ ok: false, message: "معرّف الجولة مستخدم لطلب مختلف" });
      } catch (_) {
        return res.status(503).json({ ok: false, message: "تعذر تأكيد نتيجة الجولة؛ أعد المحاولة بنفس المعرّف" });
      }
    }
    return res.status(error.status || 500).json({
      ok: false, message: error.status ? error.message : "تعذر تنفيذ الجولة"
    });
  } finally { await session.endSession(); }
});

module.exports = router;
