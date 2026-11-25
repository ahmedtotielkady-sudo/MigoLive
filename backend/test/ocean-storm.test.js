"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const ocean = require("../game-engines/ocean-storm");

test("Ocean Storm validates the original bet levels", () => {
  assert.throws(() => ocean.play({ bet: 501 }), /قيمة الرهان/);
});

test("Ocean Storm generates a server-side 6x5 board and valid settlement", () => {
  const result = ocean.play({ bet: 500, random: () => 0.99 });
  assert.equal(result.grid.length, 6);
  assert.ok(result.grid.every(column => column.length === 5));
  assert.equal(result.cost, 500);
  assert.ok(Number.isSafeInteger(result.payout));
  assert.ok(result.payout >= 0);
});

test("Ocean Storm applies ante and buy-feature cost on the server", () => {
  assert.equal(ocean.play({ bet: 2000, ante: true, random: () => 0.99 }).cost, 2500);
  assert.equal(ocean.play({ bet: 500, buyFeature: true, random: () => 0.99 }).cost, 50000);
});

test("Ocean Storm caps the original 10,000 bet at 15x", () => {
  const result = ocean.play({ bet: 10000, random: () => 0.99 });
  assert.ok(result.payout <= 150000);
});

test("Ocean Storm resolves tumbles on the server and bounds cascade loops", () => {
  const result = ocean.play({ bet: 10000, random: () => 0.99 });
  assert.ok(result.steps.length > 0);
  assert.ok(result.steps.length <= 50);
  assert.ok(result.steps.every(step =>
    step.grid.length === 6 && step.grid.every(column => column.length === 5)
  ));
  assert.ok(result.payout <= 150000);
});

test("Ocean Storm buy-feature is settled as a paid feature, not a free-spin award", () => {
  const result = ocean.play({ bet: 500, buyFeature: true, random: () => 0 });
  assert.equal(result.cost, 50000);
  assert.equal(result.outcome.freeSpinsAwarded, 0);
  assert.equal(result.freeSpinRounds.length, 0);
});

test("Ocean Storm keeps the same cascade wire format at the maximum tumble depth", () => {
  // This deterministic draw makes every board cell the same regular symbol,
  // exercising the full 50-step cascade and the optimized removal lookup.
  const result = ocean.play({ bet: 500, random: () => 0.5 });
  assert.equal(result.steps.length, 50);
  for (const step of result.steps) {
    assert.equal(step.grid.length, 6);
    assert.ok(step.grid.every(column => column.length === 5));
    assert.ok(step.removed.length > 0);
    assert.ok(step.removed.every(position => /^\\d+:\\d+$/.test(position)));
  }
  assert.ok(Number.isSafeInteger(result.payout));
  assert.ok(result.payout >= 0);
});
