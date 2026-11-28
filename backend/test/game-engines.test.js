"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const slot = require("../game-engines/slot-777");
const wheel = require("../game-engines/wheel-animals");
const fruit = require("../game-engines/fruit-luck");
const ocean = require("../game-engines/ocean-storm");
const warrior = require("../game-engines/big-warrior");

test("Slot 777 validates stake and returns the server grid dimensions", () => {
  assert.throws(() => slot.play({ bet: 41, random: () => 0 }), /الرهان/);
  const result = slot.play({ bet: 40, random: () => 0.99 });
  assert.equal(result.grid.length, 5);
  assert.ok(result.grid.every(column => column.length === 3));
  assert.ok(Number.isSafeInteger(result.win) && result.win >= 0);
});

test("Animal wheel settles the same indexed animal and multiplier", () => {
  const result = wheel.play([0, 0, 0, 0, 0, 0, 500, 0], () => {
    const bytes = Buffer.alloc(4);
    // Pick a value in the goat interval of the weighted distribution.
    bytes.writeUInt32BE(0xB0000000);
    return bytes;
  });
  assert.ok(Number.isInteger(result.index) && result.index >= 0 && result.index < wheel.ANIMALS.length);
  assert.equal(result.animal, wheel.ANIMALS[result.index].name);
  assert.equal(result.index, 6);
  assert.equal(result.animal, "ماعز");
  assert.equal(result.payout, 2500);
  assert.equal(result.net, result.payout - result.totalBet);
});

test("Fruit Luck result and payout use the same server-selected symbol", () => {
  const bets = { m: 10, "77": 10, o: 10 };
  const cases = [
    [0, "77", 80],
    [300, "o", 20],
    [700, "m", 20]
  ];
  for (const [draw, symbol, payout] of cases) {
    const result = fruit.play(bets, () => draw);
    assert.equal(result.result, symbol);
    assert.equal(result.payout, payout);
    assert.equal(result.net, payout - result.totalBet);
  }
});

test("Ocean Storm returns a 6 by 5 server grid and valid payout", () => {
  const result = ocean.play({ bet: 500, random: () => 0 });
  assert.equal(result.grid.length, 6);
  assert.ok(result.grid.every(column => column.length === 5));
  assert.ok(Number.isSafeInteger(result.cost) && result.cost >= 500);
  assert.ok(Number.isSafeInteger(result.payout) && result.payout >= 0);
  assert.ok(result.outcome && typeof result.outcome === "object");
});

test("Big Warrior winner and payout are determined by the engine", () => {
  const result = warrior.play({ bet: 100, pick: "lion", randomInt: () => 0 });
  assert.equal(result.winner, "lion");
  assert.equal(result.won, true);
  assert.equal(result.payout, 200);
  assert.throws(() => warrior.play({ bet: 99, pick: "lion" }), /الرهان/);
});

