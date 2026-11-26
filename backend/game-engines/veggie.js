const crypto = require("crypto");

const FOODS = Object.freeze([
  { key: "carrot", group: "v", multiplier: 5 },
  { key: "avocado", group: "v", multiplier: 5 },
  { key: "lettuce", group: "v", multiplier: 5 },
  { key: "tomato", group: "v", multiplier: 5 },
  { key: "wrap", group: "m", multiplier: 10 },
  { key: "sausage", group: "m", multiplier: 15 },
  { key: "pizza", group: "m", multiplier: 25 },
  { key: "chicken", group: "m", multiplier: 45 }
]);
const CHIPS = Object.freeze([10, 50, 100, 1000, 10000]);
const BET_SECONDS = 20;
const SPIN_SECONDS = 4;
const RESULT_SECONDS = 4;
const CYCLE_SECONDS = BET_SECONDS + SPIN_SECONDS + RESULT_SECONDS;

function randomInt(max) {
  return crypto.randomInt(0, max);
}
function createOutcome() {
  // Each round has exactly one server-generated result, shared by all players.
  const weights = FOODS.map(food => 1 / food.multiplier);
  const total = weights.reduce((sum, value) => sum + value, 0);
  let roll = crypto.randomInt(0, 1_000_000_000) / 1_000_000_000 * total;
  let index = 0;
  for (; index < weights.length - 1; index++) {
    roll -= weights[index];
    if (roll < 0) break;
  }
  // Group outcomes are deliberately rare and also resolved once per shared round.
  if (randomInt(500) === 0) {
    const group = randomInt(2) === 0 ? "v" : "m";
    const choices = FOODS.map((food, i) => food.group === group ? i : -1).filter(i => i >= 0);
    return { type: "group", index: null, group, target: choices[randomInt(choices.length)] };
  }
  return { type: "single", index, group: null, target: index };
}
function validateBets(value) {
  if (!Array.isArray(value) || value.length !== 8) {
    throw Object.assign(new Error("اختار الرهانات بشكل صحيح"), { status: 400 });
  }
  const amounts = value.map(Number);
  if (amounts.some(amount => !Number.isSafeInteger(amount) || amount < 0 ||
      (amount !== 0 && !CHIPS.some(chip => amount % chip === 0)))) {
    throw Object.assign(new Error("قيمة الرهان غير مسموح بها"), { status: 400 });
  }
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (!Number.isSafeInteger(total) || total <= 0 || total > 1000000) {
    throw Object.assign(new Error("إجمالي الرهان غير صالح"), { status: 400 });
  }
  return { amounts, total };
}
function winners(outcome) {
  if (outcome.type === "single") return [outcome.index];
  return FOODS.map((food, index) => food.group === outcome.group ? index : -1).filter(index => index >= 0);
}
function payoutFor(amounts, outcome) {
  return winners(outcome).reduce((sum, index) => sum + amounts[index] * FOODS[index].multiplier, 0);
}
module.exports = { FOODS, CHIPS, BET_SECONDS, SPIN_SECONDS, RESULT_SECONDS, CYCLE_SECONDS,
  createOutcome, validateBets, winners, payoutFor };
