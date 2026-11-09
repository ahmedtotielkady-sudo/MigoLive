const crypto = require("crypto");
const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const Ledger = require("../models/Ledger");

// Keep the current wheel's eight animal multipliers and inverse-multiplier
// weighting, but generate the outcome with server-side cryptographic randomness.
const ANIMALS = Object.freeze([
  { name: "نمر", multiplier: 50 },
  { name: "أسد", multiplier: 75.3 },
  { name: "فهد", multiplier: 84.5 },
  { name: "ذئب", multiplier: 75 },
  { name: "جمل", multiplier: 50 },
  { name: "حصان", multiplier: 25.1 },
  { name: "ماعز", multiplier: 15.2 },
  { name: "بقرة", multiplier: 24.3 }
]);
const WEIGHTS = ANIMALS.map(({ multiplier }) => Math.max(1, Math.round(1000000000 / multiplier)));
const WEIGHT_TOTAL = WEIGHTS.reduce((sum, value) => sum + value, 0);

function chooseWinner() {
  let pick = crypto.randomInt(WEIGHT_TOTAL);
  for (let i = 0; i < WEIGHTS.length; i += 1) {
    pick -= WEIGHTS[i];
    if (pick < 0) return i;
  }
  return WEIGHTS.length - 1;
}

function sameBets(a, b) {
  return Array.isArray(a) && a.length === b.length && a.every((value, index) => value === b[index]);
}

async function executeAnimalWheelRound({ userId, bets, reference }) {
  if (!userId || !Array.isArray(bets) || bets.length !== ANIMALS.length) {
    throw new Error("Invalid wheel bets");
  }
  if (!bets.every((value) => Number.isSafeInteger(value) && value >= 0)) {
    throw new Error("Invalid wheel bets");
  }
  const totalBet = bets.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(totalBet) || totalBet <= 0 || totalBet > 1000000) {
    throw new Error("Wheel bet must be between 1 and 1,000,000 coins");
  }
  if (typeof reference !== "string" || !/^[A-Za-z0-9._:-]{8,100}$/.test(reference)) {
    throw new Error("Invalid idempotency key");
  }

  const debitRef = reference + ":debit";
  const creditRef = reference + ":credit";
  const session = await mongoose.startSession();
  let response;

  try {
    await session.withTransaction(async () => {
      const existingDebit = await Ledger.findOne({ reference: debitRef }).session(session);
      const existingCredit = await Ledger.findOne({ reference: creditRef }).session(session);

      if (existingDebit || existingCredit) {
        const meta = existingDebit?.metadata || {};
        const valid =
          existingDebit &&
          String(existingDebit.userId) === String(userId) &&
          existingDebit.type === "game_debit" &&
          existingDebit.direction === "debit" &&
          existingDebit.status === "posted" &&
          meta.game === "animal_wheel" &&
          meta.action === "wheel_round" &&
          meta.totalBet === totalBet &&
          sameBets(meta.bets, bets) &&
          Number.isInteger(meta.resultIndex) &&
          meta.resultIndex >= 0 &&
          meta.resultIndex < ANIMALS.length &&
          Number.isSafeInteger(meta.payout) &&
          meta.payout >= 0 &&
          (meta.payout === 0
            ? !existingCredit
            : existingCredit &&
              String(existingCredit.userId) === String(userId) &&
              existingCredit.type === "game_credit" &&
              existingCredit.direction === "credit" &&
              existingCredit.status === "posted" &&
              existingCredit.amount === meta.payout &&
              existingCredit.metadata?.game === "animal_wheel" &&
              existingCredit.metadata?.action === "wheel_payout");
        if (!valid) throw new Error("Idempotency key conflict");
        const wallet = await Wallet.findOne({ userId }).select("balance").session(session).lean();
        response = {
          success: true,
          duplicate: true,
          game: "animal_wheel",
          bets,
          totalBet,
          winner: ANIMALS[meta.resultIndex],
          payout: meta.payout,
          net: meta.payout - totalBet,
          balance: wallet ? wallet.balance : 0
        };
        return;
      }

      const resultIndex = chooseWinner();
      const winner = ANIMALS[resultIndex];
      const payout = Math.floor(bets[resultIndex] * winner.multiplier);
      if (!Number.isSafeInteger(payout) || payout < 0) throw new Error("Invalid wheel payout");

      await Wallet.updateOne(
        { userId },
        { $setOnInsert: { balance: 0 } },
        { upsert: true, session }
      );
      const debit = await Wallet.updateOne(
        { userId, balance: { $gte: totalBet } },
        { $inc: { balance: -totalBet } },
        { session }
      );
      if (!debit.modifiedCount) throw new Error("Insufficient balance");

      if (payout > 0) {
        const credit = await Wallet.updateOne(
          { userId },
          { $inc: { balance: payout } },
          { session }
        );
        if (!credit.modifiedCount) throw new Error("Unable to credit wheel payout");
      }

      const metadata = {
        game: "animal_wheel",
        gameName: "عجلة الحيوانات",
        action: "wheel_round",
        bets,
        totalBet,
        resultIndex,
        winner: winner.name,
        multiplier: winner.multiplier,
        payout
      };
      await Ledger.create([{
        userId,
        type: "game_debit",
        amount: totalBet,
        direction: "debit",
        reference: debitRef,
        status: "posted",
        metadata
      }], { session });

      if (payout > 0) {
        await Ledger.create([{
          userId,
          type: "game_credit",
          amount: payout,
          direction: "credit",
          reference: creditRef,
          status: "posted",
          metadata: {
            game: "animal_wheel",
            gameName: "عجلة الحيوانات",
            action: "wheel_payout",
            roundReference: reference,
            resultIndex,
            winner: winner.name,
            multiplier: winner.multiplier,
            totalBet
          }
        }], { session });
      }

      const wallet = await Wallet.findOne({ userId }).select("balance").session(session).lean();
      response = {
        success: true,
        duplicate: false,
        game: "animal_wheel",
        bets,
        totalBet,
        winner,
        payout,
        net: payout - totalBet,
        balance: wallet.balance
      };
    });
    return response;
  } catch (error) {
    if (error.code === 11000) throw new Error("Idempotency key conflict");
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { executeAnimalWheelRound, ANIMALS };
