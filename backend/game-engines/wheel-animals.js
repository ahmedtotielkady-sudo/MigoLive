"use strict";
const crypto = require("crypto");

const ANIMALS = Object.freeze([
  { id:"tiger", name:"نمر", multiplier:50 },
  { id:"lion", name:"أسد", multiplier:75.3 },
  { id:"cheetah", name:"فهد", multiplier:84.5 },
  { id:"wolf", name:"ذئب", multiplier:75 },
  { id:"camel", name:"جمل", multiplier:50 },
  { id:"horse", name:"حصان", multiplier:25.1 },
  { id:"goat", name:"ماعز", multiplier:15.2 },
  { id:"cow", name:"بقرة", multiplier:24.3 }
]);

// Original game weighting: relative weight is inverse to the displayed multiplier.
function pick(randomBytes = crypto.randomBytes) {
  const weights = ANIMALS.map(a => 1 / a.multiplier);
  const total = weights.reduce((a, b) => a + b, 0);
  const bytes = randomBytes(4);
  const unit = bytes.readUInt32BE(0) / 0x100000000;
  let cursor = unit * total;
  for (let i = 0; i < ANIMALS.length; i++) {
    cursor -= weights[i];
    if (cursor < 0) return ANIMALS[i];
  }
  return ANIMALS[ANIMALS.length - 1];
}
function play({ bet }) {
  if (!Number.isSafeInteger(bet) || bet < 1 || bet > 1000000) {
    throw Object.assign(new Error("قيمة الرهان غير مسموح بها"), { status:400 });
  }
  const animal = pick();
  const payout = Math.floor(bet * animal.multiplier);
  if (!Number.isSafeInteger(payout)) throw Object.assign(new Error("قيمة الجائزة تجاوزت الحد"), { status:400 });
  return { animal, multiplier:animal.multiplier, payout };
}
module.exports = { ANIMALS, play };
