"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const wheel = require("../game-engines/wheel-animals");
const fruit = require("../game-engines/fruit-luck");

test("wheel game preserves the eight original animals and multipliers", () => {
  assert.deepEqual(wheel.ANIMALS.map(x => x.multiplier), [50,75.3,84.5,75,50,25.1,15.2,24.3]);
  assert.equal(wheel.ANIMALS.length, 8);
});

test("wheel result uses inverse-multiplier weighting and returns a server payout", () => {
  const chosen = wheel.play({ bet:100 });
  assert.ok(wheel.ANIMALS.some(x => x.id === chosen.animal.id));
  assert.equal(chosen.payout, Math.floor(100 * chosen.multiplier));
});

test("fruit game preserves 25/37.5/37.5 outcome bands", () => {
  assert.equal(fruit.pick(() => Buffer.from([0,0,0,0])).id, "77");
  assert.equal(fruit.pick(() => Buffer.from([0x40,0,0,0])).id, "orange");
  assert.equal(fruit.pick(() => Buffer.from([0xc0,0,0,0])).id, "melon");
});

test("both game engines reject invalid bets", () => {
  for (const engine of [wheel, fruit]) {
    assert.throws(() => engine.play({ bet:0 }), /قيمة الرهان/);
    assert.throws(() => engine.play({ bet:1.5 }), /قيمة الرهان/);
    assert.throws(() => engine.play({ bet:1000001 }), /قيمة الرهان/);
  }
});
