"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { play, normalizeBets, getRoundClock, BET_TIME_SECONDS, SPIN_TIME_SECONDS, RESULT_TIME_SECONDS, ROUND_TIME_SECONDS, FOODS, MAX_BET } = require("../game-engines/pizza-yam");
test("Pizza Yam accepts eight simultaneous bets and calculates their total", () => {
  const normalized = normalizeBets({ bets: [10, 20, 0, 0, 5, 0, 0, 1] });
  assert.equal(normalized.totalBet, 36);
  assert.deepEqual(normalized.bets, [10, 20, 0, 0, 5, 0, 0, 1]);
});
test("Pizza Yam rejects malformed, negative, empty and excessive bet arrays", () => {
  for (const bets of [[], [1], [1,2,3,4,5,6,7,8,9], [-1,0,0,0,0,0,0,0], [0,0,0,0,0,0,0,0], [MAX_BET + 1,0,0,0,0,0,0,0], [1.5,0,0,0,0,0,0,0]]) {
    assert.throws(() => normalizeBets({ bets }), { status: 400 });
  }
});
test("single-food result pays only the selected food's multiplier", () => {
  const values = [1, 0];
  const result = play({ bets: [10,0,0,0,50,0,0,0] }, () => values.shift());
  assert.equal(result.group, null);
  assert.equal(result.targetIndex, 0);
  assert.equal(result.payout, 50);
  assert.deepEqual(result.winningIndices, [0]);
});
test("group result pays every bet in the winning vegetable group", () => {
  const values = [0, 0, 0];
  const result = play({ bets: [10,20,30,40,50,60,70,80] }, () => values.shift());
  assert.equal(result.group, "v");
  assert.equal(result.payout, (10 + 20 + 30 + 40) * 5);
  assert.deepEqual(result.winningIndices, [0,1,2,3]);
});
test("meat group result applies each food's own multiplier", () => {
  const values = [0, 1, 0];
  const result = play({ bets: [0,0,0,0,10,20,30,40] }, () => values.shift());
  assert.equal(result.group, "m");
  assert.equal(result.payout, 10 * FOODS[4].multiplier + 20 * FOODS[5].multiplier + 30 * FOODS[6].multiplier + 40 * FOODS[7].multiplier);
});
test("legacy single-food request remains supported during client rollout", () => {
  assert.deepEqual(normalizeBets({ foodIndex: 6, bet: 25 }).bets, [0,0,0,0,0,0,25,0]);
});

test("Pizza Yam server clock uses 20 seconds betting, 4 seconds spin, 4 seconds result", () => {
  assert.equal(BET_TIME_SECONDS, 20);
  assert.equal(SPIN_TIME_SECONDS, 4);
  assert.equal(RESULT_TIME_SECONDS, 4);
  assert.equal(ROUND_TIME_SECONDS, 28);
  assert.equal(getRoundClock(0).phase, "bet");
  assert.equal(getRoundClock(19999).phase, "bet");
  assert.equal(getRoundClock(20000).phase, "spin");
  assert.equal(getRoundClock(23999).phase, "spin");
  assert.equal(getRoundClock(24000).phase, "result");
  assert.equal(getRoundClock(27999).phase, "result");
  assert.equal(getRoundClock(28000).round, 1);
  assert.equal(getRoundClock(28000).phase, "bet");
});
