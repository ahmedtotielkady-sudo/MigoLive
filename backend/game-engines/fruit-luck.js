"use strict";
const crypto = require("crypto");
const MULTIPLIERS = Object.freeze({ m: 2, "77": 8, o: 2 });
const MAX_TOTAL_BET = 5000000;

function play(bets, randomInt = crypto.randomInt) {
  if (!bets || typeof bets !== "object" || Array.isArray(bets) ||
      Object.keys(bets).some(key => !Object.prototype.hasOwnProperty.call(MULTIPLIERS, key)) ||
      ["m", "77", "o"].some(key => !Number.isSafeInteger(bets[key] ?? 0) || (bets[key] ?? 0) < 0)) {
    throw Object.assign(new Error("توزيع الرهانات غير صحيح"), { status: 400 });
  }
  const normalized = { m: bets.m || 0, "77": bets["77"] || 0, o: bets.o || 0 };
  const totalBet = normalized.m + normalized["77"] + normalized.o;
  if (!Number.isSafeInteger(totalBet) || totalBet < 1 || totalBet > MAX_TOTAL_BET) {
    throw Object.assign(new Error("إجمالي الرهان خارج الحد المسموح"), { status: 400 });
  }
  const roll = randomInt(0, 1000);
  const result = roll < 250 ? "77" : roll < 625 ? "o" : "m";
  const payout = normalized[result] * MULTIPLIERS[result];
  return { result, multiplier: MULTIPLIERS[result], totalBet, payout, net: payout - totalBet, requestedBets: normalized };
}
module.exports = { play, MULTIPLIERS, MAX_TOTAL_BET };
