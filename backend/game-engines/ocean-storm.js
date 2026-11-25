"use strict";

const SYMBOL_WEIGHTS = [20, 18, 16, 14, 12, 10, 8];
const PAY = [0.2, 0.25, 0.3, 0.4, 0.5, 0.8, 1.2];
const BETS = Object.freeze([500, 2000, 10000, 50000, 100000]);
const ORB_VALUES = [2,3,4,5,6,8,10,15,20,25,50,100,250,500];
const ORB_WEIGHTS = [30,24,20,16,12,9,7,5,4,3,2,1.2,.6,.3];
const HIGH_ORB_WEIGHTS = ORB_WEIGHTS.map((weight, index) => ORB_VALUES[index] >= 50 ? 0 : weight);
const SYMBOL_WEIGHT_TOTAL = SYMBOL_WEIGHTS.reduce((sum, value) => sum + value, 0);
const ORB_WEIGHT_TOTAL = ORB_WEIGHTS.reduce((sum, value) => sum + value, 0);
const HIGH_ORB_WEIGHT_TOTAL = HIGH_ORB_WEIGHTS.reduce((sum, value) => sum + value, 0);
const COLS = 6, ROWS = 5, MAX_TUMBLES = 50;

function weightedIndex(weights, total, random) {
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
    const weights = high ? HIGH_ORB_WEIGHTS : ORB_WEIGHTS;
    const total = high ? HIGH_ORB_WEIGHT_TOTAL : ORB_WEIGHT_TOTAL;
    return { type: "orb", value: ORB_VALUES[weightedIndex(weights, total, random)] };
  }
  return { type: "symbol", symbol: weightedIndex(SYMBOL_WEIGHTS, SYMBOL_WEIGHT_TOTAL, random) };
}

function makeGrid(random, high) {
  return Array.from({ length: COLS }, () =>
    Array.from({ length: ROWS }, () => makeCell(random, high)));
}

function cloneGrid(grid) {
  return grid.map(column => column.map(cell => ({ ...cell })));
}

function evaluate(grid, bet) {
  const matches = new Map();
  let scatters = 0;

  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const cell = grid[c][r];
      if (cell.type === "scatter") {
        scatters++;
      } else if (cell.type === "symbol") {
        let positions = matches.get(cell.symbol);
        if (!positions) matches.set(cell.symbol, positions = []);
        positions.push(c * ROWS + r);
      }
    }
  }

  const wins = [];
  const removed = new Set();
  let baseWin = 0;
  for (const [symbol, positions] of matches) {
    const count = positions.length;
    if (count < 8) continue;
    const tier = count >= 12 ? 5 : count >= 10 ? 2.5 : 1;
    const amount = Math.round(bet * PAY[symbol] * tier);
    baseWin += amount;
    wins.push({ symbol, count, amount });
    for (const position of positions) removed.add(position);
  }

  let orbMultiplier = 0;
  if (removed.size) {
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS; r++) {
        const cell = grid[c][r];
        if (cell.type === "orb") {
          removed.add(c * ROWS + r);
          orbMultiplier += cell.value;
        }
      }
    }
  }

  // Keep the existing wire format ("column:row") for the game animation.
  const removedPositions = Array.from(removed, position =>
    Math.floor(position / ROWS) + ":" + (position % ROWS));
  return { wins, baseWin, orbMultiplier, scatters, removed: removedPositions };
}

function tumble(grid, bet, random, high) {
  const steps = [];
  let total = 0, multiplier = 0, current = cloneGrid(grid);

  for (let n = 0; n < MAX_TUMBLES; n++) {
    const result = evaluate(current, bet);
    if (!result.removed.length) break;

    total += result.baseWin;
    multiplier += result.orbMultiplier;
    steps.push({
      grid: cloneGrid(current),
      wins: result.wins,
      baseWin: result.baseWin,
      orbMultiplier: result.orbMultiplier,
      removed: result.removed
    });

    const removed = new Set(result.removed.map(position => {
      const separator = position.indexOf(":");
      return Number(position.slice(0, separator)) * ROWS + Number(position.slice(separator + 1));
    }));
    current = current.map((column, c) => {
      const kept = column.filter((_, r) => !removed.has(c * ROWS + r));
      const missing = ROWS - kept.length;
      const fresh = Array.from({ length: missing }, () => makeCell(random, high));
      return fresh.concat(kept);
    });
  }

  let scatters = 0;
  for (const column of current) for (const cell of column) {
    if (cell.type === "scatter") scatters++;
  }
  return { steps, finalGrid: current, total, multiplier, scatters };
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
  const first = tumble(makeGrid(random, high), bet, random, high);
  let payout = Math.min(first.total * (first.multiplier || 1), cap);
  const freeSpinRounds = [];
  const freeSpinsAwarded = !buyFeature && first.scatters >= 4 ? 15 : 0;
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
    cost,
    payout,
    grid: first.finalGrid,
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
