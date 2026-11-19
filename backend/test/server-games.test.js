"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../game-engines/server-games");

test("animal wheel and fruit outcomes are selected from server tables", () => {
  assert.deepEqual(engine.spin("wheel-animals", 100, 0), { symbol:"rabbit", multiplier:0, payout:0 });
  assert.deepEqual(engine.spin("wheel-animals", 100, 420), { symbol:"fox", multiplier:2, payout:200 });
  assert.deepEqual(engine.spin("fruit-luck", 50, 800), { symbol:"orange", multiplier:3, payout:150 });
});

test("spin rejects invalid bets and unknown games", () => {
  assert.throws(() => engine.spin("wheel-animals", 0, 0), /قيمة الرهان/);
  assert.throws(() => engine.spin("fruit-luck", 100001, 0), /قيمة الرهان/);
  assert.throws(() => engine.spin("client-controlled-game", 100, 0), /غير مدعومة/);
});

test("rocket crash point is bounded and deterministic for test rolls", () => {
  assert.equal(engine.crashPoint(0), 1);
  assert.equal(engine.crashPoint(9999), 100);
  assert.ok(engine.crashPoint(5000) >= 1 && engine.crashPoint(5000) <= 100);
});

test("rocket multiplier grows with elapsed server time", () => {
  assert.equal(engine.rocketMultiplier(0), 1);
  assert.ok(engine.rocketMultiplier(5000) > engine.rocketMultiplier(1000));
  assert.ok(engine.rocketMultiplier(-100) >= 1);
});
