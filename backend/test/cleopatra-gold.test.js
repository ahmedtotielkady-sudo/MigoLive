"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),engine=require("../game-engines/cleopatra-gold");
test("Cleopatra validates allowed bets",()=>assert.throws(()=>engine.play({bet:11}),/قيمة الرهان/));
test("Cleopatra returns a server-generated 5x4 board and bounded payout",()=>{
 const r=engine.play({bet:100,random:()=>0.99});
 assert.equal(r.grid.length,5);assert.ok(r.grid.every(c=>c.length===4));
 assert.ok(Number.isSafeInteger(r.win));assert.ok(r.win>=0);assert.equal(r.freeSpins,0);
});
test("Cleopatra awards free spins from three or more server scatters",()=>{
 const r=engine.play({bet:100,random:()=>0});
 assert.ok(r.scatters>=3);assert.ok(r.freeSpins>=10);
});
test("Cleopatra free-spin round is still server generated",()=>{
 const r=engine.play({bet:500,freeSpin:true,random:()=>0.99});
 assert.equal(r.grid.length,5);assert.equal(r.freeSpins,0);
});
