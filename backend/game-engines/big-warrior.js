"use strict";
const crypto = require("crypto");
const BETS = Object.freeze([100, 500, 1000, 2000, 5000, 10000]);
function play({ bet, pick, randomInt = crypto.randomInt }) {
  if (!Number.isSafeInteger(bet) || !BETS.includes(bet)) throw Object.assign(new Error("قيمة الرهان غير مسموح بها"), { status: 400 });
  if (!["lion", "tiger", "draw"].includes(pick)) throw Object.assign(new Error("اختيار غير صحيح"), { status: 400 });
  const n = randomInt(100);
  const winner = n < 40 ? "lion" : n < 80 ? "tiger" : "draw";
  const won = winner === pick;
  const payout = won ? bet * (winner === "draw" ? 8 : 2) : 0;
  return { winner, won, payout };
}
module.exports = { play, BETS };
