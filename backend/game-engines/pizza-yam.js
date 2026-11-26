"use strict";
const crypto = require("crypto");

const FOODS = Object.freeze([
  { id: 0, emoji: "🥕", multiplier: 5, group: "v" },
  { id: 1, emoji: "🥑", multiplier: 5, group: "v" },
  { id: 2, emoji: "🥬", multiplier: 5, group: "v" },
  { id: 3, emoji: "🍅", multiplier: 5, group: "v" },
  { id: 4, emoji: "🌯", multiplier: 10, group: "m" },
  { id: 5, emoji: "🌭", multiplier: 15, group: "m" },
  { id: 6, emoji: "🍕", multiplier: 25, group: "m" },
  { id: 7, emoji: "🍗", multiplier: 45, group: "m" }
]);
const MAX_TOTAL_BET = 5000000;
const BET_SECONDS = 20;
const SPIN_SECONDS = 8;
const WAIT_SECONDS = 4;
const CYCLE_SECONDS = BET_SECONDS + SPIN_SECONDS + WAIT_SECONDS;

function normalizeBets(input) {
  if (!Array.isArray(input) || input.length !== FOODS.length ||
      input.some(v => !Number.isSafeInteger(v) || v < 0 || v % 10 !== 0)) {
    throw Object.assign(new Error("توزيع الرهانات غير صحيح"), { status: 400 });
  }
  const bets = input.slice();
  const totalBet = bets.reduce((sum, v) => sum + v, 0);
  if (!Number.isSafeInteger(totalBet) || totalBet < 1 || totalBet > MAX_TOTAL_BET) {
    throw Object.assign(new Error("إجمالي الرهان خارج الحد المسموح"), { status: 400 });
  }
  return { bets, totalBet };
}

function play(bets, randomInt = crypto.randomInt) {
  const { bets: normalized, totalBet } = normalizeBets(bets);
  // The rare group result is selected by the server, never by the game frame.
  const groupWin = randomInt(0, 500) === 0;
  let outcome;
  if (groupWin) {
    const group = randomInt(0, 2) === 0 ? "v" : "m";
    const candidates = FOODS.filter(food => food.group === group);
    const target = candidates[randomInt(0, candidates.length)];
    outcome = { type: "group", group, target: target.id, winners: candidates.map(x => x.id) };
  } else {
    const weights = FOODS.map(food => 1 / food.multiplier);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    let roll = (randomInt(0, 1000000) / 1000000) * totalWeight;
    let index = weights.length - 1;
    for (let i = 0; i < weights.length; i++) {
      roll -= weights[i];
      if (roll <= 0) { index = i; break; }
    }
    outcome = { type: "single", target: index, winners: [index] };
  }
  const payout = outcome.winners.reduce((sum, index) =>
    sum + normalized[index] * FOODS[index].multiplier, 0);
  return {
    bets: normalized, totalBet, payout, net: payout - totalBet,
    outcome: { ...outcome, emoji: FOODS[outcome.target].emoji,
      multiplier: FOODS[outcome.target].multiplier },
    foods: FOODS
  };
}

function currentRound(now = Date.now()) {
  const cycleMs = CYCLE_SECONDS * 1000;
  const round = Math.floor(now / cycleMs);
  const offset = (now - round * cycleMs) / 1000;
  return { round, offset, cycleSeconds: CYCLE_SECONDS,
    betSeconds: BET_SECONDS, spinSeconds: SPIN_SECONDS };
}

module.exports = { FOODS, MAX_TOTAL_BET, BET_SECONDS, SPIN_SECONDS, WAIT_SECONDS,
  CYCLE_SECONDS, normalizeBets, play, currentRound };
