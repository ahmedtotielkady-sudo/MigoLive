"use strict";

const SYMBOL_WEIGHTS = [20, 18, 16, 14, 12, 10, 8];
const PAY = [0.2, 0.25, 0.3, 0.4, 0.5, 0.8, 1.2];
const BETS = [500, 2000, 10000, 50000, 100000];
const ORB_VALUES = [2,3,4,5,6,8,10,15,20,25,50,100,250,500];
const ORB_WEIGHTS = [30,24,20,16,12,9,7,5,4,3,2,1.2,.6,.3];
const COLS = 6, ROWS = 5, MAX_TUMBLES = 50;

function weightedIndex(weights, random) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  let roll = random() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i;
  }
  return weights.length - 1;
}
function makeCell(random, high) {
  const scatterWeight = high ? 0.8 : 1.6;
  const orbWeight = high ? 0.25 : 1.1;
  const roll = random() * (100 + scatterWeight + orbWeight);
  if (roll < scatterWeight) return { type: "scatter" };
  if (roll < scatterWeight + orbWeight) {
    const weights = high ? ORB_WEIGHTS.map((w, i) => ORB_VALUES[i] >= 50 ? 0 : w) : ORB_WEIGHTS;
    return { type: "orb", value: ORB_VALUES[weightedIndex(weights, random)] };
  }
  return { type: "symbol", symbol: weightedIndex(SYMBOL_WEIGHTS, random) };
}
function makeGrid(random, high) {
  return Array.from({ length: COLS }, () =>
    Array.from({ length: ROWS }, () => makeCell(random, high)));
}
function cloneGrid(grid) { return grid.map(column => column.map(cell => ({ ...cell }))); }
function evaluate(grid, bet) {
  const matches = new Map();
  for (let c = 0; c < COLS; c++) for (let r = 0; r < grid[c].length; r++) {
    const cell = grid[c][r];
    if (cell.type === "symbol") {
      if (!matches.has(cell.symbol)) matches.set(cell.symbol, []);
      matches.get(cell.symbol).push({ c, r });
    }
  }
  const wins = [];
  const removed = new Set();
  let baseWin = 0;
  for (const [symbol, positions] of matches) {
    const count = positions.length;
    if (count >= 8) {
      const tier = count >= 12 ? 5 : count >= 10 ? 2.5 : 1;
      const amount = Math.round(bet * PAY[symbol] * tier);
      baseWin += amount;
      wins.push({ symbol, count, amount });
      positions.forEach(({ c, r }) => removed.add(c + ":" + r));
    }
  }
  let orbMultiplier = 0;
  if (removed.size) {
    for (let c = 0; c < COLS; c++) for (let r = 0; r < grid[c].length; r++) {
      const cell = grid[c][r];
      if (cell.type === "orb") {
        removed.add(c + ":" + r);
        orbMultiplier += cell.value;
      }
    }
  }
  const scatters = grid.flat().filter(cell => cell.type === "scatter").length;
  return { wins, baseWin, orbMultiplier, scatters, removed: [...removed] };
}
function tumble(grid, bet, random, high) {
  const steps = [];
  let total = 0, multiplier = 0, current = cloneGrid(grid);
  for (let n = 0; n < MAX_TUMBLES; n++) {
    const result = evaluate(current, bet);
    if (!result.removed.length) break;
    total += result.baseWin;
    multiplier += result.orbMultiplier;
    steps.push({ grid: cloneGrid(current), wins: result.wins, baseWin: result.baseWin,
      orbMultiplier: result.orbMultiplier, removed: result.removed });
    current = current.map((column, c) => {
      const kept = column.filter((_, r) => !result.removed.includes(c + ":" + r));
      const missing = ROWS - kept.length;
      const fresh = Array.from({ length: missing }, () => makeCell(random, high));
      return fresh.concat(kept);
    });
  }
  return { steps, finalGrid: current, total, multiplier,
    scatters: current.flat().filter(cell => cell.type === "scatter").length };
}
function play({ bet, ante = false, buyFeature = false, random = Math.random }) {
  if (!Number.isSafeInteger(bet) || !BETS.includes(bet)) {
    throw Object.assign(new Error("قيمة الرهان غير مسموح بها"), { status: 400 });
  }
  if (typeof ante !== "boolean" || typeof buyFeature !== "boolean" || typeof random !== "function") {
    throw Object.assign(new Error("خيارات الجولة غير صحيحة"), { status: 400 });
  }
  const cost = buyFeature ? bet * 100 : Math.round(bet * (ante ? 1.25 : 1));
  const high = bet > 500;
  const cap = bet === 10000 ? bet * 15 : Number.MAX_SAFE_INTEGER;
  let first = tumble(makeGrid(random, high), bet, random, high);
  let payout = Math.min(first.total * (first.multiplier || 1), cap);
  const freeSpinRounds = [];
  let freeSpinsAwarded = !buyFeature && first.scatters >= 4 ? 15 : 0;
  let freeSpinsRemaining = freeSpinsAwarded;
  let freeSpinMultiplier = 0;
  let freeSpinTotal = 0;
  while (freeSpinsRemaining > 0 && freeSpinRounds.length < 100) {
    freeSpinsRemaining--;
    const round = tumble(makeGrid(random, high), bet, random, high);
    freeSpinMultiplier += round.multiplier;
    const amount = Math.min(round.total * (freeSpinMultiplier || 1),
      Math.max(0, cap - freeSpinTotal));
    freeSpinTotal += amount;
    freeSpinRounds.push({ ...round, awardedPayout: amount, multiplierTotal: freeSpinMultiplier });
    if (round.scatters >= 4) freeSpinsRemaining += 15;
  }
  if (!buyFeature) payout = Math.min(cap, payout + freeSpinTotal);
  return {
    cost, payout, grid: first.finalGrid,
    steps: first.steps,
    freeSpinRounds,
    outcome: {
      wins: first.steps.flatMap(step => step.wins),
      orbMultiplier: first.multiplier,
      scatters: first.scatters,
      multiplier: first.multiplier || 1,
      buyFeature,
      freeSpinsAwarded,
      freeSpinsPlayed: freeSpinRounds.length,
      freeSpinPayout: freeSpinTotal,
      capped: payout === cap && cap !== Number.MAX_SAFE_INTEGER
    }
  };
}

module.exports = { play, BETS };
