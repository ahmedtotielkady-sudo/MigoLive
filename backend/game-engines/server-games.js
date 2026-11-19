"use strict";
const crypto = require("crypto");

// All outcome selection and multipliers are server-owned. Never accept a
// client-supplied symbol, multiplier, payout, or crash point.
const CONFIG = Object.freeze({
  "wheel-animals": [
    { symbol: "rabbit", weight: 420, multiplier: 0 },
    { symbol: "fox", weight: 260, multiplier: 2 },
    { symbol: "lion", weight: 170, multiplier: 3 },
    { symbol: "eagle", weight: 100, multiplier: 5 },
    { symbol: "dragon", weight: 50, multiplier: 10 }
  ],
  "fruit-luck": [
    { symbol: "lemon", weight: 420, multiplier: 0 },
    { symbol: "grape", weight: 260, multiplier: 2 },
    { symbol: "orange", weight: 170, multiplier: 3 },
    { symbol: "watermelon", weight: 100, multiplier: 5 },
    { symbol: "seven", weight: 50, multiplier: 10 }
  ]
});
const MIN_BET = 10;
const MAX_BET = 100000;
function pickWeighted(entries, roll = crypto.randomInt(entries.reduce((s, x) => s + x.weight, 0))) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (!Number.isSafeInteger(roll) || roll < 0 || roll >= total) throw new RangeError("roll out of range");
  let cursor = roll;
  for (const entry of entries) {
    if (cursor < entry.weight) return entry;
    cursor -= entry.weight;
  }
  throw new Error("invalid weighted table");
}
function spin(gameId, bet, roll) {
  if (!Object.prototype.hasOwnProperty.call(CONFIG, gameId)) throw new Error("لعبة غير مدعومة");
  if (!Number.isSafeInteger(bet) || bet < MIN_BET || bet > MAX_BET) {
    throw Object.assign(new Error("قيمة الرهان غير مسموح بها"), { status: 400 });
  }
  const selected = pickWeighted(CONFIG[gameId], roll);
  return Object.freeze({
    symbol: selected.symbol,
    multiplier: selected.multiplier,
    payout: bet * selected.multiplier
  });
}
function crashPoint(roll = crypto.randomInt(1, 10000)) {
  if (!Number.isSafeInteger(roll) || roll < 0 || roll >= 10000) throw new RangeError("roll out of range");
  // Heavy-tailed server-side crash distribution, bounded to 100x.
  const sample = 1 / (1 - roll / 10000);
  return Math.min(100, Math.max(1, Math.floor(sample * 100) / 100));
}
function rocketMultiplier(elapsedMs) {
  const seconds = Math.max(0, elapsedMs) / 1000;
  return Math.floor(Math.exp(0.12 * seconds) * 100) / 100;
}
module.exports = { CONFIG, MIN_BET, MAX_BET, pickWeighted, spin, crashPoint, rocketMultiplier };
