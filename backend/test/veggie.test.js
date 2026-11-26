const test = require("node:test");
const assert = require("node:assert/strict");
const veggie = require("../game-engines/veggie");

test("Veggie round uses the requested shared cycle", () => {
  assert.equal(veggie.BET_SECONDS, 20);
  assert.equal(veggie.SPIN_SECONDS, 8);
  assert.equal(veggie.RESULT_SECONDS, 4);
  assert.equal(veggie.CYCLE_SECONDS, 32);
});

test("Veggie accepts eight valid bet slots and totals them", () => {
  const parsed = veggie.validateBets([10, 50, 100, 1000, 10000, 0, 0, 0]);
  assert.equal(parsed.total, 11160);
  assert.equal(parsed.amounts.length, 8);
});

test("Veggie rejects malformed, fractional, and oversized bets", () => {
  assert.throws(() => veggie.validateBets([10, 20]), /اختار الرهانات/);
  assert.throws(() => veggie.validateBets([1.5, 0, 0, 0, 0, 0, 0, 0]), /قيمة الرهان/);
  assert.throws(() => veggie.validateBets([1000010, 0, 0, 0, 0, 0, 0, 0]), /إجمالي الرهان/);
});

test("Veggie single and group outcomes settle using server multipliers", () => {
  assert.equal(veggie.payoutFor([10, 0, 0, 0, 0, 0, 0, 0], {
    type: "single", index: 0, group: null, target: 0
  }), 50);
  assert.equal(veggie.payoutFor([10, 20, 30, 40, 0, 0, 0, 0], {
    type: "group", index: null, group: "v", target: 2
  }), 500);
  assert.equal(veggie.payoutFor([0, 0, 0, 0, 10, 20, 30, 40], {
    type: "group", index: null, group: "m", target: 6
  }), 10*10 + 20*15 + 30*25 + 40*45);
});

test("Veggie outcomes are valid server-generated targets", () => {
  for (let i = 0; i < 500; i++) {
    const outcome = veggie.createOutcome();
    assert.ok(["single", "group"].includes(outcome.type));
    assert.ok(Number.isInteger(outcome.target) && outcome.target >= 0 && outcome.target < 8);
    if (outcome.type === "single") assert.ok(outcome.index >= 0 && outcome.index < 8);
    else assert.ok(["v", "m"].includes(outcome.group));
  }
});
