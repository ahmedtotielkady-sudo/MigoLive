const test = require("node:test");
const assert = require("node:assert/strict");
const game = require("../game-engines/veggie");

test("Veggie round uses the requested 20/4/4 timing", () => {
  assert.equal(game.BET_SECONDS, 20);
  assert.equal(game.SPIN_SECONDS, 4);
  assert.equal(game.RESULT_SECONDS, 4);
  assert.equal(game.CYCLE_SECONDS, 28);
});

test("validates eight bet lanes and accepted chip denominations", () => {
  const parsed = game.validateBets([10, 50, 100, 1000, 10000, 0, 0, 0]);
  assert.equal(parsed.total, 11160);
  assert.deepEqual(parsed.amounts, [10, 50, 100, 1000, 10000, 0, 0, 0]);
  assert.throws(() => game.validateBets([10, 0, 0]), /اختار الرهانات/);
  assert.throws(() => game.validateBets([11, 0, 0, 0, 0, 0, 0, 0]), /قيمة الرهان/);
  assert.throws(() => game.validateBets([-10, 0, 0, 0, 0, 0, 0, 0]), /قيمة الرهان/);
});

test("single outcome pays only its matching lane", () => {
  assert.equal(game.payoutFor([10, 20, 30, 40, 50, 60, 70, 80],
    { type: "single", index: 6 }), 70 * 25);
});

test("group outcome pays every lane in the winning food group", () => {
  assert.equal(game.payoutFor([10, 20, 30, 40, 50, 60, 70, 80],
    { type: "group", group: "v" }), 10 * 5 + 20 * 5 + 30 * 5 + 40 * 5);
  assert.equal(game.payoutFor([10, 20, 30, 40, 50, 60, 70, 80],
    { type: "group", group: "m" }), 50 * 10 + 60 * 15 + 70 * 25 + 80 * 45);
});

test("server outcome always targets a valid food lane", () => {
  for (let i = 0; i < 1000; i++) {
    const outcome = game.createOutcome();
    assert.ok(["single", "group"].includes(outcome.type));
    assert.ok(Number.isInteger(outcome.target) && outcome.target >= 0 && outcome.target < 8);
    if (outcome.type === "single") assert.equal(outcome.index, outcome.target);
    else assert.ok(["v", "m"].includes(outcome.group));
  }
});
