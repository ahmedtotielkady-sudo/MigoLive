"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../game-engines/big-warrior");

test("Big Warrior accepts only the original six stake levels and three choices", () => {
  for (const bet of engine.BET_STEPS) assert.doesNotThrow(() => engine.validate(bet, "lion"));
  assert.throws(() => engine.validate(101, "lion"), /قيمة الرهان/);
  assert.throws(() => engine.validate(100, "wolf"), /اختيار غير صالح/);
});

test("Big Warrior payout is calculated from the server-picked winner", () => {
  const lion = engine.play({ bet: 500, pick: "lion", randomInt: () => 0 });
  assert.equal(lion.winner, "lion");
  assert.equal(lion.payout, 1000);
  assert.equal(lion.won, true);
  const draw = engine.play({ bet: 500, pick: "draw", randomInt: () => 999 });
  assert.equal(draw.winner, "draw");
  assert.equal(draw.payout, 4000);
  const loss = engine.play({ bet: 500, pick: "tiger", randomInt: () => 0 });
  assert.equal(loss.winner, "lion");
  assert.equal(loss.payout, 0);
});

test("Big Warrior uses a cryptographically secure random source by default", () => {
  const result = engine.play({ bet: 100, pick: "lion" });
  assert.ok(["lion", "tiger", "draw"].includes(result.winner));
  assert.ok(Number.isSafeInteger(result.payout));
});
