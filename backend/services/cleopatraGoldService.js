const crypto = require("crypto");
const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const Ledger = require("../models/Ledger");
const CleopatraGoldState = require("../models/CleopatraGoldState");
const CleopatraGoldRound = require("../models/CleopatraGoldRound");

const SYMBOLS = [
  ["W", "كليوباترا", 4], ["S", "جعران", 4], ["P", "فرعون", 5],
  ["O", "تاج", 5], ["C", "صندوق", 5], ["D", "أنوبيس", 8],
  ["F", "صقر", 8], ["H", "كوبرا", 8], ["A", "قطة", 12],
  ["E", "عين", 13], ["N", "أنخ", 14], ["Y", "هرم", 14]
];
const REGULAR = SYMBOLS.map((s) => s[0]).filter((s) => s !== "W" && s !== "S");
const PAY = Object.freeze({
  P: { 3: 10, 4: 50, 5: 250 }, O: { 3: 10, 4: 50, 5: 250 },
  C: { 3: 10, 4: 50, 5: 250 }, D: { 3: 6, 4: 24, 5: 120 },
  F: { 3: 6, 4: 24, 5: 120 }, H: { 3: 6, 4: 24, 5: 120 },
  A: { 3: 3, 4: 10, 5: 45 }, E: { 3: 3, 4: 10, 5: 45 },
  N: { 3: 3, 4: 10, 5: 45 }, Y: { 3: 3, 4: 10, 5: 45 }
});
const BETS = [10, 20, 50, 100, 200, 500, 1000];
const SCATTER_PAYOUT = [0, 0, 0, 2, 10, 50];
const FREE_SPINS = [0, 0, 0, 10, 15, 20];
const WEIGHT_TOTAL = SYMBOLS.reduce((sum, s) => sum + s[2], 0);

function randomSymbol(reel, freeSpin) {
  const allowed = SYMBOLS.filter((s) => !(s[0] === "W" && freeSpin && (reel === 0 || reel === 4)));
  const total = allowed.reduce((sum, s) => sum + s[2], 0);
  let pick = crypto.randomInt(total);
  for (const symbol of allowed) {
    pick -= symbol[2];
    if (pick < 0) return symbol[0];
  }
  return allowed[allowed.length - 1][0];
}
function makeGrid(freeSpin) {
  return Array.from({ length: 5 }, (_, reel) =>
    Array.from({ length: 4 }, () => randomSymbol(reel, freeSpin))
  );
}
function evaluate(grid, bet) {
  let win = 0, scatterCount = 0;
  const hit = new Set(), scatterCells = [];
  for (let reel = 0; reel < 5; reel += 1) {
    for (let row = 0; row < 4; row += 1) {
      if (grid[reel][row] === "S") {
        scatterCount += 1;
        scatterCells.push(reel + "," + row);
      }
    }
  }
  for (const symbol of REGULAR) {
    let ways = 1, count = 0;
    for (let reel = 0; reel < 5; reel += 1) {
      const matchingRows = [];
      for (let row = 0; row < 4; row += 1) {
        if (grid[reel][row] === symbol || grid[reel][row] === "W") matchingRows.push(row);
      }
      if (!matchingRows.length) break;
      ways *= matchingRows.length;
      count += 1;
      if (count >= 3) {
        for (let row = 0; row < 4; row += 1) {
          if (grid[reel][row] === symbol || grid[reel][row] === "W") hit.add(reel + "," + row);
        }
      }
    }
    if (count >= 3) win += PAY[symbol][count] * ways * (bet / 100);
  }
  if (scatterCount >= 3) {
    const n = Math.min(scatterCount, 5);
    win += bet * SCATTER_PAYOUT[n];
    scatterCells.forEach((cell) => hit.add(cell));
  }
  win = Math.round(win);
  if (!Number.isSafeInteger(win) || win < 0) throw new Error("Invalid Cleopatra payout");
  return { win, scatterCount, hit: [...hit], freeSpinsAwarded: scatterCount >= 3 ? FREE_SPINS[Math.min(scatterCount, 5)] : 0 };
}
function validReference(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}
function sameRequest(round, userId, betIndex) {
  return String(round.userId) === String(userId) && round.betIndex === betIndex;
}

async function getCleopatraGoldState({ userId }) {
  const [state, wallet] = await Promise.all([
    CleopatraGoldState.findOne({ userId }).lean(),
    Wallet.findOne({ userId }).select("balance").lean()
  ]);
  return {
    freeSpins: state?.freeSpins || 0,
    multiplier: state?.multiplier || 1,
    freeSpinWinnings: state?.freeSpinWinnings || 0,
    freeSpinBetIndex: state?.freeSpinBetIndex ?? null,
    balance: wallet?.balance || 0
  };
}

async function playCleopatraGold({ userId, betIndex, reference }) {
  if (!userId || !Number.isInteger(betIndex) || betIndex < 0 || betIndex >= BETS.length) throw new Error("Invalid Cleopatra bet");
  if (!validReference(reference)) throw new Error("Invalid idempotency key");
  const session = await mongoose.startSession();
  let response;
  try {
    await session.withTransaction(async () => {
      const existing = await CleopatraGoldRound.findOne({ reference }).session(session).lean();
      if (existing) {
        if (!sameRequest(existing, userId, betIndex)) throw new Error("Idempotency key conflict");
        const wallet = await Wallet.findOne({ userId }).select("balance").session(session).lean();
        response = {
          success: true, duplicate: true, game: "cleopatra_gold", grid: existing.grid,
          win: existing.win, scatterCount: existing.scatterCount, hit: existing.hit,
          freeSpin: existing.freeSpin, freeSpinsAwarded: existing.freeSpinsAwarded,
          freeSpins: existing.freeSpinsRemaining, multiplier: existing.multiplier,
          freeSpinWinnings: existing.freeSpinWinnings, balance: wallet?.balance || 0,
          bet: existing.freeSpin ? 0 : BETS[existing.betIndex]
        };
        return;
      }
      await Wallet.updateOne({ userId }, { $setOnInsert: { balance: 0 } }, { upsert: true, session });
      await CleopatraGoldState.updateOne({ userId }, { $setOnInsert: { freeSpins: 0, multiplier: 1, freeSpinWinnings: 0 } }, { upsert: true, session });
      const state = await CleopatraGoldState.findOne({ userId }).session(session);
      const freeSpin = state.freeSpins > 0;
      const effectiveBetIndex = freeSpin && Number.isInteger(state.freeSpinBetIndex) ? state.freeSpinBetIndex : betIndex;
      const bet = BETS[effectiveBetIndex];
      if (freeSpin) {
        state.freeSpins -= 1;
      } else {
        const debit = await Wallet.updateOne({ userId, balance: { $gte: bet } }, { $inc: { balance: -bet } }, { session });
        if (!debit.modifiedCount) throw new Error("Insufficient balance");
        await Ledger.create([{
          userId, type: "game_debit", amount: bet, direction: "debit",
          reference: reference + ":debit", status: "posted",
          metadata: { game: "cleopatra_gold", gameName: "ذهب كليوباترا", action: "spin", betIndex: effectiveBetIndex }
        }], { session });
      }
      const grid = makeGrid(freeSpin);
      const appliedMultiplier = freeSpin ? state.multiplier : 1;
      const outcome = evaluate(grid, bet);
      outcome.win *= appliedMultiplier;
      if (!Number.isSafeInteger(outcome.win) || outcome.win < 0) throw new Error("Invalid Cleopatra payout");
      if (freeSpin && outcome.win > 0) state.multiplier = Math.min(state.multiplier + 1, 10);
      state.freeSpinWinnings += freeSpin ? outcome.win : 0;
      const freeSpinWinningsTotal = state.freeSpinWinnings;
      state.freeSpins = Math.min(1000, state.freeSpins + outcome.freeSpinsAwarded);
      if (outcome.freeSpinsAwarded > 0 && !freeSpin) state.freeSpinBetIndex = effectiveBetIndex;
      const freeSpinEnded = freeSpin && state.freeSpins === 0;
      if (state.freeSpins === 0) {
        state.multiplier = 1;
        state.freeSpinWinnings = 0;
        state.freeSpinBetIndex = null;
      }
      if (outcome.win > 0) {
        const credit = await Wallet.updateOne({ userId }, { $inc: { balance: outcome.win } }, { session });
        if (!credit.modifiedCount) throw new Error("Unable to credit Cleopatra payout");
        await Ledger.create([{
          userId, type: "game_credit", amount: outcome.win, direction: "credit",
          reference: reference + ":credit", status: "posted",
          metadata: { game: "cleopatra_gold", gameName: "ذهب كليوباترا", action: "payout", betIndex: effectiveBetIndex, freeSpin }
        }], { session });
      }
      await state.save({ session });
      const wallet = await Wallet.findOne({ userId }).select("balance").session(session).lean();
      const round = {
        userId, reference, betIndex: effectiveBetIndex, freeSpin, grid,
        win: outcome.win, scatterCount: outcome.scatterCount,
        freeSpinsAwarded: outcome.freeSpinsAwarded, freeSpinsRemaining: state.freeSpins,
        multiplier: appliedMultiplier,
        balance: wallet.balance, hit: outcome.hit, freeSpinWinnings: state.freeSpinWinnings
      };
      await CleopatraGoldRound.create([round], { session });
      response = {
        success: true, duplicate: false, game: "cleopatra_gold", grid,
        win: outcome.win, scatterCount: outcome.scatterCount, hit: outcome.hit,
        freeSpin, freeSpinsAwarded: outcome.freeSpinsAwarded, freeSpins: state.freeSpins,
        multiplier: state.multiplier, freeSpinWinnings: state.freeSpinWinnings,
        freeSpinWinningsTotal, freeSpinEnded,
        betIndex: effectiveBetIndex, balance: wallet.balance, bet: freeSpin ? 0 : bet
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

module.exports = { playCleopatraGold, getCleopatraGoldState, BETS };
