"use strict";
const crypto = require("crypto");

// Preserves the original three result classes and their stated probabilities:
// 77 = 25%; orange = 37.5%; melon = 37.5%.
const SYMBOLS = Object.freeze([
  { id:"77", multiplier:8, weight:1 },
  { id:"orange", multiplier:2, weight:1.5 },
  { id:"melon", multiplier:2, weight:1.5 }
]);
function pick(randomBytes = crypto.randomBytes) {
  const n = randomBytes(4).readUInt32BE(0) / 0x100000000;
  if (n < 0.25) return SYMBOLS[0];
  return n < 0.625 ? SYMBOLS[1] : SYMBOLS[2];
}
function play({ bet }) {
  if (!Number.isSafeInteger(bet) || bet < 1 || bet > 1000000) {
    throw Object.assign(new Error("قيمة الرهان غير مسموح بها"), { status:400 });
  }
  const symbol = pick();
  const payout = Math.floor(bet * symbol.multiplier);
  if (!Number.isSafeInteger(payout)) throw Object.assign(new Error("قيمة الجائزة تجاوزت الحد"), { status:400 });
  return { symbol, multiplier:symbol.multiplier, payout };
}
module.exports = { SYMBOLS, play };
