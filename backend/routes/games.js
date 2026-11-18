const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const GameRound = require("../models/GameRound");
const GameState = require("../models/GameState");
const requireAuth = require("../middleware/requireAuth");
const requireGameEnabled = require("../middleware/requireGameEnabled");
const slot777 = require("../game-engines/slot-777");

const router = express.Router();
// The catalog exposes only games whose outcomes are settled by the server.
// Games without a verified server engine remain visible but cannot debit coins.
const GAME_CATALOG = Object.freeze([
  { id:"slot-777", name:"سلوت 777", visible:true, active:false, endpoint:"/slot-777/spin" },
  { id:"ocean-storm", name:"عاصفة المحيط", visible:true, active:false, endpoint:"/ocean-storm/spin" },
  { id:"wheel-animals", name:"عجلة الحيوانات", visible:true, active:false, endpoint:"/wheel-animals/spin" },
  { id:"cleopatra-gold", name:"ذهب كليوباترا", visible:true, active:false, endpoint:"/cleopatra-gold/spin" },
  { id:"fruit-luck", name:"حظ الفواكه", visible:true, active:false, endpoint:"/fruit-luck/spin" },
  { id:"rocket-crash", name:"الصاروخ", visible:true, active:false, endpoint:"/rocket-crash/start" },
  { id:"big-warrior", name:"المحارب الكبير", visible:true, active:false, endpoint:"/big-warrior/play" }
]);
router.get("/catalog", (req, res) => res.json({
  ok:true,
  wallet:"central",
  games:GAME_CATALOG.map(game => ({
    ...game,
    wallet:"central",
    settlement:"server_api_ready_pending_frontend_wiring_and_database_integration_tests"
  }))
}));

router.use(requireAuth, requireGameEnabled);

// Only this route is live initially. Other game IDs remain unavailable until
// their original payout rules have been ported and independently tested.
router.post("/slot-777/spin", async (req, res) => {
  const bet = Number(req.body && req.body.bet);
  const key = String(req.get("idempotency-key") || "");
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
        userId: user._id, gameId: "slot-777", roundId, idempotencyKey: key,
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
    return res.status(error.status || 500).json({
      ok: false, message: error.status ? error.message : "تعذر تنفيذ الجولة"
    });
  } finally {
    await session.endSession();
  }
});

module.exports = router;
