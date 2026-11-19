"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../game-engines/wheel-animals");

test("wheel validates eight safe non-negative bet slots and a bounded total", () => {
  assert.throws(() => engine.play([500]), /توزيع الرهانات/);
  assert.throws(() => engine.play([500, -1, 0, 0, 0, 0, 0, 0]), /توزيع الرهانات/);
  assert.throws(() => engine.play([5000001, 0, 0, 0, 0, 0, 0, 0]), /توزيع الرهانات/);
  assert.throws(() => engine.play([0, 0, 0, 0, 0, 0, 0, 0]), /إجمالي الرهان/);
});

test("wheel outcome and payout are generated on the server", () => {
  const result = engine.play([500, 0, 0, 0, 0, 0, 0, 0], () => Buffer.from([0, 0, 0, 0]));
  assert.equal(result.index, 0);
  assert.equal(result.animal, "نمر");
  assert.equal(result.multiplier, 25);
  assert.equal(result.totalBet, 500);
  assert.equal(result.payout, 12500);
  assert.equal(result.net, 12000);
});

test("wheel uses a cryptographically random draw by default", () => {
  const result = engine.play([0, 0, 500, 0, 0, 0, 0, 0]);
  assert.equal(result.totalBet, 500);
  assert.ok(result.index >= 0 && result.index < 8);
  assert.ok(Number.isSafeInteger(result.payout));
});
