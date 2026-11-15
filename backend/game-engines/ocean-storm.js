"use strict";

const SYMBOL_WEIGHTS = [20, 18, 16, 14, 12, 10, 8];
const PAY = [0.2, 0.25, 0.3, 0.4, 0.5, 0.8, 1.2];
const BETS = [500, 2000, 10000, 50000, 100000];
const ORB_VALUES = [2,3,4,5,6,8,10,15,20,25,50,100,250,500];
const ORB_WEIGHTS = [30,24,20,16,12,9,7,5,4,3,2,1.2,.6,.3];

function weightedIndex(weights, random) {
  const total = weights.reduce((sum, value) => sum + value, 0);
  let roll = random() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

function play({ bet, ante = false, buyFeature = false, random = Math.random }) {
  if (!Number.isSafeInteger(bet) || !BETS.includes(bet)) {
    throw Object.assign(new Error("قيمة الرهان غير مسموح بها"), { status: 400 });
  }
  if (typeof ante !== "boolean" || typeof buyFeature !== "boolean") {
    throw Object.assign(new Error("خيارات الجولة غير صحيحة"), { status: 400 });
  }
  const cost = buyFeature ? bet * 100 : Math.round(bet * (ante ? 1.25 : 1));
  const high = bet > 500;
  const scatterWeight = high ? 0.8 : 1.6;
  const orbWeight = high ? 0.25 : 1.1;
  const cells = [];
  const counts = Array(7).fill(0);
  let orbMultiplier = 0, scatters = 0;
  for (let i = 0; i < 30; i++) {
    const roll = random() * (100 + scatterWeight + orbWeight);
    if (roll < scatterWeight) {
      cells.push({ type: "scatter" }); scatters++;
    } else if (roll < scatterWeight + orbWeight) {
      const weights = high ? ORB_WEIGHTS.map((w, j) => ORB_VALUES[j] >= 50 ? 0 : w) : ORB_WEIGHTS;
      const value = ORB_VALUES[weightedIndex(weights, random)];
      cells.push({ type: "orb", value }); orbMultiplier += value;
    } else {
      const symbol = weightedIndex(SYMBOL_WEIGHTS, random);
      cells.push({ type: "symbol", symbol }); counts[symbol]++;
    }
  }
  let baseWin = 0;
  const wins = [];
  for (let symbol = 0; symbol < counts.length; symbol++) {
    const count = counts[symbol];
    if (count >= 8) {
      const tier = count >= 12 ? 5 : count >= 10 ? 2.5 : 1;
      const amount = Math.round(bet * PAY[symbol] * tier);
      baseWin += amount;
      wins.push({ symbol, count, amount });
    }
  }
  const multiplier = orbMultiplier || 1;
  let payout = baseWin > 0 ? Math.round(baseWin * multiplier) : 0;
  const cap = bet === 10000 ? bet * 15 : Number.MAX_SAFE_INTEGER;
  payout = Math.min(payout, cap);
  return {
    cost, payout, grid: Array.from({ length: 6 }, (_, col) => cells.slice(col * 5, col * 5 + 5)),
    outcome: { wins, orbMultiplier, scatters, multiplier, buyFeature, capped: payout === cap && cap !== Number.MAX_SAFE_INTEGER }
  };
}

module.exports = { play, BETS };
