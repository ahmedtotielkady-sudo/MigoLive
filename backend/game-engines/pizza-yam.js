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
const MAX_BET = 10000000;
function play(input, randomInt = crypto.randomInt) {
  const foodIndex = Number(input && input.foodIndex);
  const bet = Number(input && input.bet);
  if (!Number.isInteger(foodIndex) || foodIndex < 0 || foodIndex >= FOODS.length)
    throw Object.assign(new Error("اختيار الطعام غير صحيح"), { status: 400 });
  if (!Number.isSafeInteger(bet) || bet < 1 || bet > MAX_BET)
    throw Object.assign(new Error("قيمة الرهان خارج الحد المسموح"), { status: 400 });
  // The server chooses either a group result (salad/meat plate) or one food.
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
  const wins = group ? FOODS[foodIndex].group === group : foodIndex === targetIndex;
  const payout = wins ? bet * FOODS[foodIndex].multiplier : 0;
  return {
    selectedIndex: foodIndex, targetIndex, group,
    winningIndices: group ? FOODS.map((food, index) => food.group === group ? index : -1).filter(index => index >= 0) : [targetIndex],
    multiplier: wins ? FOODS[foodIndex].multiplier : 0,
    payout, totalBet: bet
  };
}
module.exports = { play, FOODS, MAX_BET };
