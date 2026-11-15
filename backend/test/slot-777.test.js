"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../game-engines/slot-777");

test("Slot 777 creates a 5x3 server-generated grid", () => {
  const result = engine.play({ bet: 40, random: () => 0.999 });
  assert.equal(result.grid.length, 5);
  assert.ok(result.grid.every(column => column.length === 3));
  assert.ok(result.grid.flat().every(symbol => Number.isInteger(symbol) && symbol >= 0 && symbol <= 10));
});

test("free spins never generate WILD symbols", () => {
  const result = engine.play({ bet: 40, freeSpin: true, random: () => 0.5 });
  assert.ok(result.grid.flat().every(symbol => symbol !== 9));
});

test("bonus awards the original free-spin counts", () => {
  const result = engine.play({ bet: 40, random: () => 0.999 });
  assert.equal(result.bonus, 15);
  assert.equal(result.freeSpins, 10);
});

test("only the four original bet levels are accepted", () => {
  assert.throws(() => engine.play({ bet: 41 }), /قيمة الرهان/);
});
