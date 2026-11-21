"use strict";

// Server-authoritative Slot 777 rules mirrored from the existing game UI.
// Symbol IDs: 0..8 regular, 9 WILD, 10 BONUS.
const WT = [5,4,3,8,7,6,7,6,6,3,2];
const WILD = 9, BONUS = 10, BASE = 40;
const MULTIPLIERS = [1,5,50,250];
const PAY = [
  {2:3,3:30,4:60,5:250},{2:4,3:35,4:80,5:300},
  {2:5,3:40,4:120,5:400},{3:5,4:20,5:75},
  {3:7,4:25,5:100},{2:3,3:20,4:50,5:240},
  {3:10,4:30,5:125},{3:15,4:40,5:200},{3:12,4:35,5:150}
];
const LINES = [
[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],
[0,0,1,2,2],[2,2,1,0,0],[1,2,0,2,1],[1,0,2,0,1],[0,1,0,1,0],
[2,1,2,1,2],[1,0,1,2,1],[1,2,1,0,1],[0,1,1,1,0],[2,1,1,1,2],
[1,0,0,0,1],[1,2,2,2,1],[0,2,2,2,0],[2,0,0,0,2],[0,0,2,0,0],
[2,2,0,2,2],[1,1,0,1,1],[1,1,2,1,1],[0,2,0,2,0],[2,0,2,0,2],
[2,0,1,2,0],[0,2,1,0,2],[0,2,1,2,0],[2,0,1,0,2],[2,1,0,0,1],
[0,1,2,2,1],[0,1,0,1,2],[2,1,2,1,0],[1,0,2,1,2],[1,2,0,1,0],
[2,2,0,0,0],[0,0,2,2,2],[0,0,1,1,2],[2,2,1,1,0],[0,1,1,2,2]
];
const FREE_SPINS = {3:3,4:6,5:10};

function pickSymbol(freeSpin, random) {
  const weights = WT.map((weight, index) => freeSpin && index === WILD ? 0 : weight);
  let roll = random() * weights.reduce((sum, value) => sum + value, 0);
  for (let i=0;i<weights.length;i++) { roll -= weights[i]; if (roll < 0) return i; }
  return weights.length - 1;
}
function evaluate(grid, bet) {
  const lineBet = bet / 40;
  let win = 0, bonus = 0;
  const hits = new Set();
  for (const column of grid) for (const symbol of column) if (symbol === BONUS) bonus++;
  for (const line of LINES) {
    const symbols = line.map((row, column) => grid[column][row]);
    let base = symbols.find(symbol => symbol !== WILD);
    if (base === undefined) base = 2;
    if (base === BONUS) continue;
    let count = 0;
    while (count < 5 && (symbols[count] === base || symbols[count] === WILD)) count++;
    const payout = PAY[base] && PAY[base][count];
    if (payout) {
      win += lineBet * payout;
      for (let i=0;i<count;i++) hits.add(i + "," + line[i]);
    }
  }
  if (bonus >= 3) grid.forEach((column, i) => column.forEach((symbol, row) => {
    if (symbol === BONUS) hits.add(i + "," + row);
  }));
  return { win: Math.max(0, Math.round(win)), bonus, freeSpins: FREE_SPINS[Math.min(bonus,5)] || 0, hits: [...hits] };
}
function play({ bet, freeSpin = false, random = Math.random }) {
  if (!Number.isSafeInteger(bet) || !MULTIPLIERS.some(multiplier => bet === BASE * multiplier)) {
    throw Object.assign(new Error("قيمة الرهان غير مسموح بها"), { status: 400 });
  }
  const grid = Array.from({length:5}, () => Array.from({length:3}, () => pickSymbol(freeSpin, random)));
  return { grid, ...evaluate(grid, bet) };
}
module.exports = { play, BASE, MULTIPLIERS };
