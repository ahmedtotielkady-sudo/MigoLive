"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../game-engines/rocket-crash");

test("crash point is random, never below 1x, and capped at 22x", () => {
  assert.equal(engine.generateCrashPoint(() => 0), 1);
  assert.equal(engine.generateCrashPoint(() => 0.5), 1.92);
  assert.equal(engine.generateCrashPoint(() => 0.99), 22);
  assert.equal(engine.generateCrashPoint(() => 0.9999), 22);
  assert.equal(engine.generateCrashPoint(() => 0.9), 9.59);
  assert.ok(engine.generateCrashPoint(() => 0.7) < engine.generateCrashPoint(() => 0.99));
  for (let i = 0; i < 10000; i++) {
    const point = engine.generateCrashPoint(() => Math.random());
    assert.ok(point >= 1 && point <= engine.MAX_MULTIPLIER);
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
