"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../game-engines/rocket-crash");

test("every rocket round crashes exactly at 22x", () => {
  for (let i = 0; i < 10000; i++) {
    assert.equal(engine.generateCrashPoint(), 22);
  }
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
