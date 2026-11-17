"use strict";
const crypto = require("crypto");

const ANIMALS = [
  { name: "نمر", multiplier: 25 },
  { name: "أسد", multiplier: 45 },
  { name: "فهد", multiplier: 15 },
  { name: "ذئب", multiplier: 10 },
  { name: "جمل", multiplier: 5 },
  { name: "حصان", multiplier: 5 },
  { name: "ماعز", multiplier: 5 },
  { name: "بقرة", multiplier: 5 }
];
const CHIPS = [500, 1000, 10000, 100000];
const MAX_TOTAL_BET = 5000000;

function play(bets, randomBytes = crypto.randomBytes) {
  if (!Array.isArray(bets) || bets.length !== ANIMALS.length ||
      bets.some(value => !Number.isSafeInteger(value) || value < 0 || value > MAX_TOTAL_BET || value % 500 !== 0)) {
    throw Object.assign(new Error("توزيع الرهانات غير صحيح"), { status: 400 });
  }
  const totalBet = bets.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(totalBet) || totalBet < 1 || totalBet > MAX_TOTAL_BET) {
    throw Object.assign(new Error("إجمالي الرهان خارج الحد المسموح"), { status: 400 });
  }
  const weights = ANIMALS.map(animal => 1 / animal.multiplier);
  const sum = weights.reduce((a, b) => a + b, 0);
  const bytes = randomBytes(4);
  const random = bytes.readUInt32BE(0) / 0x100000000;
  let roll = random * sum, index = weights.length - 1;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) { index = i; break; }
  }
  const payout = bets[index] * ANIMALS[index].multiplier;
  return {
    index, animal: ANIMALS[index].name, multiplier: ANIMALS[index].multiplier,
    totalBet, payout, net: payout - totalBet
  };
}
module.exports = { play, ANIMALS, CHIPS, MAX_TOTAL_BET };
