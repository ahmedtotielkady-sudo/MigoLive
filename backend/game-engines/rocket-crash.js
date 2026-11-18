"use strict";

const BETS = Object.freeze([10, 100, 200, 500, 1000, 2000, 5000, 10000]);
const GROWTH_RATE = 0.13;
const START_DELAY_MS = 5000;

function generateCrashPoint(random = Math.random) {
  const value = Math.min(0.999999999999, Math.max(0, Number(random())));
  return Math.max(1, Math.floor(96 / (1 - value)) / 100);
}

function multiplierAt(startAt, now = Date.now()) {
  const elapsedSeconds = Math.max(0, (Number(now) - Number(startAt)) / 1000);
  return Math.exp(GROWTH_RATE * elapsedSeconds);
}

function validateBet(bet) {
  if (!Number.isSafeInteger(bet) || !BETS.includes(bet)) {
    throw Object.assign(new Error("قيمة الرهان غير مسموح بها"), { status: 400 });
  }
}

module.exports = { BETS, GROWTH_RATE, START_DELAY_MS, generateCrashPoint, multiplierAt, validateBet };
