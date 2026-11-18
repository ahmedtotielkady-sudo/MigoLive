"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../game-engines/rocket-crash");

test("crash point follows the legacy distribution and never falls below 1.00x", () => {
  assert.equal(engine.generateCrashPoint(() => 0), 1);
  assert.equal(engine.generateCrashPoint(() => 0.5), 1.92);
  assert.equal(engine.generateCrashPoint(() => 0.99), 96);
  assert.ok(engine.generateCrashPoint(() => 0.9999) >= 1);
});

test("multiplier starts at 1x and grows at the documented game rate", () => {
  assert.equal(engine.multiplierAt(1000, 1000), 1);
  assert.ok(Math.abs(engine.multiplierAt(1000, 2000) - Math.exp(0.13)) < 1e-12);
  assert.equal(engine.multiplierAt(2000, 1000), 1);
});

test("only supported rocket bets are accepted", () => {
  for (const bet of engine.BETS) assert.doesNotThrow(() => engine.validateBet(bet));
  for (const bet of [0, -10, 11, 20, 100000, 1.5]) {
    assert.throws(() => engine.validateBet(bet), error => error.status === 400);
  }
});
