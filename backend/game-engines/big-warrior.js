"use strict";
const crypto = require("crypto");

const BET_STEPS = Object.freeze([100, 500, 1000, 2000, 5000, 10000]);
const MULTIPLIERS = Object.freeze({ lion: 2, tiger: 2, draw: 8 });

function validate(bet, pick) {
  if (!Number.isSafeInteger(bet) || !BET_STEPS.includes(bet)) {
    throw Object.assign(new Error("قيمة الرهان غير مسموح بها"), { status: 400 });
  }
  if (!Object.prototype.hasOwnProperty.call(MULTIPLIERS, pick)) {
    throw Object.assign(new Error("اختيار غير صالح"), { status: 400 });
  }
}
function play({ bet, pick, randomInt = crypto.randomInt } = {}) {
  validate(bet, pick);
  const roll = randomInt(1000);
  const winner = roll < 450 ? "lion" : roll < 900 ? "tiger" : "draw";
  const won = winner === pick;
  const payout = won ? bet * MULTIPLIERS[winner] : 0;
  return { requestedBet: bet, pick, winner, won, multiplier: won ? MULTIPLIERS[winner] : 0, payout };
}
module.exports = { BET_STEPS, MULTIPLIERS, validate, play };
