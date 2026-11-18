"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const engine = require("../game-engines/big-warrior");
test("Big Warrior validates bets and picks", () => {
  assert.throws(() => engine.play({ bet: 99, pick:"lion" }), /قيمة الرهان/);
  assert.throws(() => engine.play({ bet: 100, pick:"horse" }), /اختيار غير صحيح/);
});
test("Big Warrior uses deterministic server outcome and payout rules", () => {
  assert.deepEqual(engine.play({ bet:100, pick:"lion", randomInt:()=>0 }), { winner:"lion", won:true, payout:200 });
  assert.deepEqual(engine.play({ bet:100, pick:"tiger", randomInt:()=>40 }), { winner:"tiger", won:true, payout:200 });
  assert.deepEqual(engine.play({ bet:100, pick:"draw", randomInt:()=>80 }), { winner:"draw", won:true, payout:800 });
  assert.deepEqual(engine.play({ bet:100, pick:"lion", randomInt:()=>80 }), { winner:"draw", won:false, payout:0 });
});
