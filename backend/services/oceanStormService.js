const crypto = require("crypto");
const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const Ledger = require("../models/Ledger");

const BETS = Object.freeze([500, 2000, 10000, 50000, 100000]);
const SYMBOL_WEIGHTS = Object.freeze([20, 18, 16, 14, 12, 10, 8]);
const PAY = Object.freeze([0.2, 0.25, 0.3, 0.4, 0.5, 0.8, 1.2]);
const ORB_VALUES = Object.freeze([2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 50, 100, 250, 500]);
const ORB_WEIGHTS = Object.freeze([30, 24, 20, 16, 12, 9, 7, 5, 4, 3, 2, 1.2, 0.6, 0.3]);

function weightedIndex(weights) {
  const scale = 10;
  const integerWeights = weights.map((value) => Math.round(value * scale));
  const total = integerWeights.reduce((sum, value) => sum + value, 0);
  let pick = crypto.randomInt(total);
  for (let index = 0; index < integerWeights.length; index += 1) {
    pick -= integerWeights[index];
    if (pick < 0) return index;
  }
  return integerWeights.length - 1;
}

function randomCell(bet) {
  const highBet = bet > 500;
  const scatterWeight = highBet ? 0.8 : 1.6;
  const orbWeight = highBet ? 0.25 : 1.1;
  const pick = crypto.randomInt(10000 + Math.round(scatterWeight * 100) + Math.round(orbWeight * 100));
  const scatterCutoff = Math.round(scatterWeight * 100);
  const orbCutoff = scatterCutoff + Math.round(orbWeight * 100);
  if (pick < scatterCutoff) return { t: "sc" };
  if (pick < orbCutoff) {
    const weights = highBet
      ? ORB_WEIGHTS.map((weight, index) => ORB_VALUES[index] >= 50 ? 0 : weight)
      : ORB_WEIGHTS;
    return { t: "orb", v: ORB_VALUES[weightedIndex(weights)] };
  }
  return { t: "s", v: weightedIndex(SYMBOL_WEIGHTS) };
}

function makeBoard(bet) {
  return Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => randomCell(bet)));
}

function scatterCount(board) {
  return board.reduce((sum, column) => sum + column.filter((cell) => cell.t === "sc").length, 0);
}

function tumble(board, bet, maxPayout) {
  let total = 0;
  let multiplier = 0;
  const cascades = [];
  for (let step = 0; step < 30; step += 1) {
    const positions = Array.from({ length: 7 }, () => []);
    board.forEach((column, c) => column.forEach((cell, r) => {
      if (cell.t === "s") positions[cell.v].push([c, r]);
    }));
    const matched = [];
    let stepWin = 0;
    positions.forEach((cells, symbol) => {
      if (cells.length < 8) return;
      const tier = cells.length >= 12 ? 5 : cells.length >= 10 ? 2.5 : 1;
      stepWin += Math.floor(bet * PAY[symbol] * tier);
      matched.push(...cells);
    });
    if (!matched.length) break;

    const orbs = [];
    board.forEach((column, c) => column.forEach((cell, r) => {
      if (cell.t === "orb") orbs.push([c, r, cell.v]);
    }));
    orbs.forEach(([, , value]) => { multiplier += value; });
    const remove = new Set(matched.map(([c, r]) => c + ":" + r));
    orbs.forEach(([c, r]) => remove.add(c + ":" + r));
    total += stepWin;
    cascades.push({ win: stepWin, multiplier, removed: remove.size });

    for (let c = 0; c < board.length; c += 1) {
      const keep = board[c].filter((_, r) => !remove.has(c + ":" + r));
      const missing = 5 - keep.length;
      const refill = Array.from({ length: missing }, () => randomCell(bet));
      board[c] = refill.concat(keep);
    }
    if (total >= maxPayout) {
      total = maxPayout;
      break;
    }
  }
  return { total: Math.min(total, maxPayout), multiplier, cascades, board, scatters: scatterCount(board) };
}

function playRound(bet, maxPayout) {
  return tumble(makeBoard(bet), bet, maxPayout);
}

function sameRound(entry, userId, bet, ante) {
  const meta = entry?.metadata || {};
  return String(entry?.userId) === String(userId) &&
    entry.type === "game_debit" && entry.direction === "debit" &&
    entry.status === "posted" && meta.game === "ocean_storm" &&
    meta.action === "spin" && meta.bet === bet && meta.ante === ante &&
    Number.isSafeInteger(meta.payout) && meta.payout >= 0;
}

async function playOceanStorm({ userId, betIndex, ante, reference }) {
  if (!userId || !Number.isInteger(betIndex) || betIndex < 0 || betIndex >= BETS.length) {
    throw new Error("Invalid Ocean Storm bet");
  }
  if (typeof ante !== "boolean") throw new Error("Invalid ante option");
  if (typeof reference !== "string" || !/^[A-Za-z0-9._:-]{8,100}$/.test(reference)) {
    throw new Error("Invalid idempotency key");
  }

  const bet = BETS[betIndex];
  const cost = ante ? Math.ceil(bet * 1.25) : bet;
  const maxPayout = bet === 10000 ? bet * 15 : Number.MAX_SAFE_INTEGER;
  const debitRef = reference + ":debit";
  const creditRef = reference + ":credit";
  const session = await mongoose.startSession();
  let response;

  try {
    await session.withTransaction(async () => {
      const existingDebit = await Ledger.findOne({ reference: debitRef }).session(session);
      const existingCredit = await Ledger.findOne({ reference: creditRef }).session(session);
      if (existingDebit || existingCredit) {
        if (!sameRound(existingDebit, userId, bet, ante)) throw new Error("Idempotency key conflict");
        const payout = existingDebit.metadata.payout;
        const validCredit = payout === 0
          ? !existingCredit
          : existingCredit && String(existingCredit.userId) === String(userId) &&
            existingCredit.type === "game_credit" && existingCredit.direction === "credit" &&
            existingCredit.status === "posted" && existingCredit.amount === payout &&
            existingCredit.metadata?.game === "ocean_storm" &&
            existingCredit.metadata?.action === "payout";
        if (!validCredit) throw new Error("Idempotency key conflict");
        const wallet = await Wallet.findOne({ userId }).select("balance").session(session).lean();
        response = {
          success: true, duplicate: true, game: "ocean_storm",
          bet, cost, payout, net: payout - cost,
          balance: wallet?.balance || 0,
          outcome: existingDebit.metadata.outcome
        };
        return;
      }

      await Wallet.updateOne({ userId }, { $setOnInsert: { balance: 0 } }, { upsert: true, session });
      const debit = await Wallet.updateOne(
        { userId, balance: { $gte: cost } },
        { $inc: { balance: -cost } },
        { session }
      );
      if (!debit.modifiedCount) throw new Error("Insufficient balance");

      const paid = playRound(bet, maxPayout);
      let payout = Math.min(
        paid.multiplier > 0 ? paid.total * paid.multiplier : paid.total,
        maxPayout
      );
      payout = Math.floor(payout);
      let freeSpinsAwarded = paid.scatters >= 4 ? 15 : 0;
      const freeSpinResults = [];
      let freeTotal = 0;
      let freeMultiplier = 0;
      let remaining = freeSpinsAwarded;

      while (remaining > 0 && freeTotal < maxPayout) {
        remaining -= 1;
        const free = playRound(bet, maxPayout);
        if (free.multiplier > 0) freeMultiplier += free.multiplier;
        const raw = free.total > 0 ? free.total * (freeMultiplier > 0 ? freeMultiplier : 1) : 0;
        const freeWin = Math.floor(Math.min(raw, Math.max(0, maxPayout - freeTotal)));
        freeTotal += freeWin;
        if (free.scatters >= 4) remaining = Math.min(1000, remaining + 15);
        freeSpinResults.push({
          board: free.board,
          win: freeWin,
          multiplier: freeMultiplier,
          scatters: free.scatters,
          cascades: free.cascades
        });
      }
      payout = Math.floor(Math.min(maxPayout, payout + freeTotal));

      const outcome = {
        board: paid.board,
        cascades: paid.cascades,
        multiplier: paid.multiplier,
        scatters: paid.scatters,
        freeSpinsAwarded,
        freeSpinResults
      };
      await Ledger.create([{
        userId,
        type: "game_debit",
        amount: cost,
        direction: "debit",
        reference: debitRef,
        status: "posted",
        metadata: {
          game: "ocean_storm",
          gameName: "عاصفة المحيط",
          action: "spin",
          bet,
          ante,
          payout,
          outcome
        }
      }], { session });

      if (payout > 0) {
        await Wallet.updateOne({ userId }, { $inc: { balance: payout } }, { session });
        await Ledger.create([{
          userId,
          type: "game_credit",
          amount: payout,
          direction: "credit",
          reference: creditRef,
          status: "posted",
          metadata: {
            game: "ocean_storm",
            gameName: "عاصفة المحيط",
            action: "payout",
            roundReference: reference,
            bet,
            ante
          }
        }], { session });
      }

      const wallet = await Wallet.findOne({ userId }).select("balance").session(session).lean();
      response = {
        success: true, duplicate: false, game: "ocean_storm",
        bet, cost, payout, net: payout - cost,
        balance: wallet?.balance || 0,
        outcome
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

module.exports = { playOceanStorm, BETS };
