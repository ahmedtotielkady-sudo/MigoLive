"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const wheel = require("../game-engines/wheel-animals");
const fruit = require("../game-engines/fruit-luck");
const rocket = require("../game-engines/rocket-crash");

test("Animal Wheel keeps the eight original animal positions and multipliers", () => {
  assert.deepEqual(wheel.ANIMALS.map(x => x.multiplier), [25,45,15,10,5,5,5,5]);
  assert.deepEqual(wheel.CHIPS, [500,1000,10000,100000]);
});

test("Animal Wheel outcome is server-generated and pays only the selected position", () => {
  const randomBytes = n => Buffer.from([0,0,0,0]);
  const result = wheel.play([500,0,0,0,0,0,0,0], randomBytes);
  assert.equal(result.index, 0);
  assert.equal(result.animal, "نمر");
  assert.equal(result.multiplier, 25);
  assert.equal(result.payout, 12500);
  assert.equal(result.totalBet, 500);
});

test("Animal Wheel rejects invalid bet arrays", () => {
  assert.throws(() => wheel.play([500]), /توزيع الرهانات/);
  assert.throws(() => wheel.play([501,0,0,0,0,0,0,0]), /توزيع الرهانات/);
  assert.throws(() => wheel.play([0,0,0,0,0,0,0,0]), /إجمالي الرهان/);
});

test("Fruit Luck preserves original segments and payout multipliers", () => {
  assert.deepEqual(fruit.SEGMENTS, ["o","77","m","o","m","o","m","o","m"]);
  assert.deepEqual(fruit.MULTIPLIERS, {m:2,"77":8,o:2});
});

test("Fruit Luck result is generated server-side and settles selected stake only", () => {
  const result = fruit.play({m:100,"77":50,o:200}, () => 0);
  assert.equal(result.result, "77");
  assert.equal(result.multiplier, 8);
  assert.equal(result.payout, 400);
  assert.equal(result.totalBet, 350);
});

test("Fruit Luck rejects invalid bets and client-supplied outcome fields", () => {
  assert.throws(() => fruit.play({m:101}), /توزيع الرهانات/);
  assert.throws(() => fruit.play({m:100, outcome:"777"}), /توزيع الرهانات/);
  assert.throws(() => fruit.play({m:0}), /إجمالي الرهان/);
});

test("Rocket Crash validates only the original bet chips", () => {
  for (const bet of rocket.BETS) assert.doesNotThrow(() => rocket.validateBet(bet));
  assert.throws(() => rocket.validateBet(50), /قيمة الرهان/);
});

test("Rocket Crash starts after five seconds and grows at the original rate", () => {
  assert.equal(rocket.START_DELAY_MS, 5000);
  assert.equal(rocket.multiplierAt(1000, 1000), 1);
  assert.ok(rocket.multiplierAt(1000, 6000) > 1);
});

test("Rocket Crash point generator remains finite for extreme random inputs", () => {
  for (const value of [0, 0.25, 0.5, 0.9, 0.999999]) {
    const point = rocket.generateCrashPoint(() => value);
    assert.ok(Number.isFinite(point));
    assert.ok(point >= 1);
  }
});
