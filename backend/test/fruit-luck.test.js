"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../game-engines/fruit-luck");

test("fruit luck validates bet buckets and maximum exposure", () => {
  assert.throws(() => engine.play({ m: -1, "77": 0, o: 0 }), /توزيع الرهانات/);
  assert.throws(() => engine.play({ m: 5000001, "77": 0, o: 0 }), /إجمالي الرهان/);
  assert.throws(() => engine.play({ m: 0, "77": 0, o: 0 }), /إجمالي الرهان/);
  assert.throws(() => engine.play({ m: 100, "77": 0, o: 0, extra: 1 }), /توزيع الرهانات/);
});

test("fruit luck payout is calculated from the server result", () => {
  const seven = engine.play({ m: 0, "77": 100, o: 0 }, () => 0);
  assert.equal(seven.result, "77");
  assert.equal(seven.multiplier, 8);
  assert.equal(seven.payout, 800);
  const other = engine.play({ m: 100, "77": 0, o: 0 }, () => 999);
  assert.equal(other.result, "m");
  assert.equal(other.payout, 200);
});

test("fruit luck accepts only the defined bet buckets", () => {
  const result = engine.play({ m: 50, "77": 0, o: 50 }, () => 624);
  assert.equal(result.result, "o");
  assert.equal(result.totalBet, 100);
  assert.equal(result.payout, 100);
});
