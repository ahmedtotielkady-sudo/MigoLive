"use strict";
const crypto = require("crypto");
const FOODS = Object.freeze([
  { emoji: "🥕", multiplier: 5, group: "v" },
  { emoji: "🥑", multiplier: 5, group: "v" },
  { emoji: "🥬", multiplier: 5, group: "v" },
  { emoji: "🍅", multiplier: 5, group: "v" },
  { emoji: "🌯", multiplier: 10, group: "m" },
  { emoji: "🌭", multiplier: 15, group: "m" },
  { emoji: "🍕", multiplier: 25, group: "m" },
  { emoji: "🍗", multiplier: 45, group: "m" }
]);
const BET_TIME_SECONDS = 20;
const SPIN_TIME_SECONDS = 4;
const RESULT_TIME_SECONDS = 4;
const ROUND_TIME_SECONDS = BET_TIME_SECONDS + SPIN_TIME_SECONDS + RESULT_TIME_SECONDS;
const MAX_BET = 10000000;
function getRoundClock(nowMs = Date.now()) {
  const round = Math.floor(nowMs / (ROUND_TIME_SECONDS * 1000));
  const elapsedMs = nowMs - round * ROUND_TIME_SECONDS * 1000;
  const elapsedSeconds = elapsedMs / 1000;
  const phase = elapsedSeconds < BET_TIME_SECONDS ? "bet"
    : elapsedSeconds < BET_TIME_SECONDS + SPIN_TIME_SECONDS ? "spin" : "result";
  const phaseEndsAt = (round * ROUND_TIME_SECONDS + (phase === "bet" ? BET_TIME_SECONDS : phase === "spin" ? BET_TIME_SECONDS + SPIN_TIME_SECONDS : ROUND_TIME_SECONDS)) * 1000;
  return { round, phase, elapsedMs, remainingMs: Math.max(0, phaseEndsAt - nowMs), serverTime: nowMs,
    roundStartsAt: round * ROUND_TIME_SECONDS * 1000, betEndsAt: (round * ROUND_TIME_SECONDS + BET_TIME_SECONDS) * 1000,
    spinEndsAt: (round * ROUND_TIME_SECONDS + BET_TIME_SECONDS + SPIN_TIME_SECONDS) * 1000,
    roundEndsAt: (round + 1) * ROUND_TIME_SECONDS * 1000 };
}
function normalizeBets(input) {
  let bets;
  if (Array.isArray(input && input.bets)) bets = input.bets;
  else if (input && Number.isInteger(Number(input.foodIndex)) && input.bet !== undefined) {
    bets = Array.from({ length: FOODS.length }, (_, i) => i === Number(input.foodIndex) ? Number(input.bet) : 0);
  } else throw Object.assign(new Error("قائمة الرهانات غير صحيحة"), { status: 400 });
  if (bets.length !== FOODS.length || bets.some(v => !Number.isSafeInteger(v) || v < 0))
    throw Object.assign(new Error("كل رهان يجب أن يكون عددًا صحيحًا غير سالب"), { status: 400 });
  const totalBet = bets.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(totalBet) || totalBet < 1 || totalBet > MAX_BET)
    throw Object.assign(new Error("إجمالي الرهان خارج الحد المسموح"), { status: 400 });
  return { bets: bets.slice(), totalBet };
}
function play(input, randomInt = crypto.randomInt) {
  const normalized = normalizeBets(input);
  const groupRoll = randomInt(0, 500);
  let group = null, targetIndex;
  if (groupRoll === 0) {
    group = randomInt(0, 2) === 0 ? "v" : "m";
    const options = FOODS.map((food, index) => food.group === group ? index : -1).filter(index => index >= 0);
    targetIndex = options[randomInt(0, options.length)];
  } else {
    const weights = FOODS.map(food => 1 / food.multiplier);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let draw = randomInt(0, 1000000) / 1000000 * total;
    targetIndex = weights.findIndex(weight => (draw -= weight) <= 0);
    if (targetIndex < 0) targetIndex = FOODS.length - 1;
  }
  const winningIndices = group
    ? FOODS.map((food, index) => food.group === group ? index : -1).filter(index => index >= 0)
    : [targetIndex];
  const payout = winningIndices.reduce((sum, index) => sum + normalized.bets[index] * FOODS[index].multiplier, 0);
  return {
    bets: normalized.bets, selectedIndex: targetIndex, targetIndex, group,
    winningIndices, multiplier: group ? null : (normalized.bets[targetIndex] ? FOODS[targetIndex].multiplier : 0),
    payout, totalBet: normalized.totalBet
  };
}
module.exports = { play, normalizeBets, getRoundClock, BET_TIME_SECONDS, SPIN_TIME_SECONDS, RESULT_TIME_SECONDS, ROUND_TIME_SECONDS, FOODS, MAX_BET };
