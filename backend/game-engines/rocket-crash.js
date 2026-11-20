"use strict";

const { randomInt } = require("node:crypto");
const BETS = Object.freeze([10, 100, 200, 500, 1000, 2000, 5000, 10000]);
const GROWTH_RATE = 0.13;
const MAX_MULTIPLIER = 22;
const START_DELAY_MS = 5000;

function generateCrashPoint() {
  // Secure random crash point from 1.00x through 22.00x, rounded to 0.01x.
  // Squared distribution favors lower crash points while allowing long rounds.
  const draw = randomInt(0, 10001) / 10000;
  const multiplier = 1 + (draw * draw * (MAX_MULTIPLIER - 1));
  return Math.min(MAX_MULTIPLIER, Math.round(multiplier * 100) / 100);
}

function multiplierAt(startAt, now = Date.now()) {
  const elapsedSeconds = Math.max(0, (Number(now) - Number(startAt)) / 1000);
  return Math.min(MAX_MULTIPLIER, Math.exp(GROWTH_RATE * elapsedSeconds));
}

function validateBet(bet) {
  if (!Number.isSafeInteger(bet) || !BETS.includes(bet)) {
    throw Object.assign(new Error("قيمة الرهان غير مسموح بها"), { status: 400 });
  }
}

module.exports = { BETS, GROWTH_RATE, MAX_MULTIPLIER, START_DELAY_MS, generateCrashPoint, multiplierAt, validateBet };
