"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../game-engines/rocket-crash");

test("rocket crash points vary within the supported 1.00x–22.00x range", () => {
  const points = Array.from({ length: 10000 }, () => engine.generateCrashPoint());
  for (const point of points) {
    assert.ok(point >= 1 && point <= engine.MAX_MULTIPLIER);
    assert.equal(Math.round(point * 100) / 100, point);
  }
  assert.ok(new Set(points).size > 100, "rounds should not all use one fixed crash point");
  assert.ok(points.some(point => point < 10), "some rounds should crash below 10x");
  assert.ok(points.some(point => point < 22), "not every round should reach the cap");
});

test("multiplier starts at 1x, grows at the documented rate, and never exceeds 22x", () => {
  assert.equal(engine.multiplierAt(1000, 1000), 1);
  assert.ok(Math.abs(engine.multiplierAt(1000, 2000) - Math.exp(0.13)) < 1e-12);
  assert.equal(engine.multiplierAt(2000, 1000), 1);
  assert.equal(engine.multiplierAt(1000, 50000), 22);
});

test("only supported rocket bets are accepted", () => {
  for (const bet of engine.BETS) assert.doesNotThrow(() => engine.validateBet(bet));
  for (const bet of [0, -10, 11, 20, 100000, 1.5]) {
    assert.throws(() => engine.validateBet(bet), error => error.status === 400);
  }
});
