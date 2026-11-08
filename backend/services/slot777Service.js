const crypto = require("crypto");
const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const Ledger = require("../models/Ledger");
const Slot777State = require("../models/Slot777State");
const Slot777Round = require("../models/Slot777Round");

const WT = [5,4,3,8,7,6,7,6,6,3,2];
const WILD = 9, BONUS = 10, BASE = 40, MULT = [1,5,50,250];
const PAY = [{2:3,3:30,4:60,5:250},{2:4,3:35,4:80,5:300},{2:5,3:40,4:120,5:400},{3:5,4:20,5:75},{3:7,4:25,5:100},{2:3,3:20,4:50,5:240},{3:10,4:30,5:125},{3:15,4:40,5:200},{3:12,4:35,5:150}];
const LINES = [[1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,2,0,2,1],[1,0,2,0,1],[0,1,0,1,0],[2,1,2,1,2],[1,0,1,2,1],[1,2,1,0,1],[0,1,1,1,0],[2,1,1,1,2],[1,0,0,0,1],[1,2,2,2,1],[0,2,2,2,0],[2,0,0,0,2],[0,0,2,0,0],[2,2,0,2,2],[1,1,0,1,1],[1,1,2,1,1],[0,2,0,2,0],[2,0,2,0,2],[2,0,1,2,0],[0,2,1,0,2],[0,2,1,2,0],[2,0,1,0,2],[2,1,0,0,1],[0,1,2,2,1],[0,1,0,1,2],[2,1,2,1,0],[1,0,2,1,2],[1,2,0,1,0],[2,2,0,0,0],[0,0,2,2,2],[0,0,1,1,2],[2,2,1,1,0],[0,1,1,2,2]];
const FREE = {3:3,4:6,5:10};

function randomSymbol(freeSpin) {
  const weights = WT.map((weight, index) => freeSpin && index === WILD ? 0 : weight);
  const total = weights.reduce((sum, value) => sum + value, 0);
  let pick = crypto.randomInt(total);
  for (let i = 0; i < weights.length; i += 1) {
    pick -= weights[i];
    if (pick < 0) return i;
  }
  return 0;
}
function makeGrid(freeSpin) {
  return Array.from({ length: 5 }, () => Array.from({ length: 3 }, () => randomSymbol(freeSpin)));
}
function evaluate(grid, bet) {
  const lineBet = bet / 40;
  let win = 0;
  let bonus = 0;
  const hit = new Set();
  grid.forEach((column) => column.forEach((symbol) => { if (symbol === BONUS) bonus += 1; }));
  LINES.forEach((line) => {
    const symbols = line.map((row, column) => grid[column][row]);
    let base = symbols.find((symbol) => symbol !== WILD);
    if (base === undefined) base = 2;
    if (base === BONUS) return;
    let count = 0;
    while (count < 5 && (symbols[count] === base || symbols[count] === WILD)) count += 1;
    const multiplier = PAY[base]?.[count] || 0;
    if (multiplier > 0) {
      win += lineBet * multiplier;
      for (let column = 0; column < count; column += 1) hit.add(column + "," + line[column]);
    }
  });
  if (bonus >= 3) grid.forEach((column, x) => column.forEach((symbol, y) => { if (symbol === BONUS) hit.add(x + "," + y); }));
  if (!Number.isSafeInteger(win) || win < 0) throw new Error("Invalid slot payout");
  return { win, bonus, hit: [...hit] };
}
function sameRequest(round, userId, multiplierIndex) {
  return String(round.userId) === String(userId) && round.multiplierIndex === multiplierIndex;
}
async function playSlot777({ userId, multiplierIndex, reference }) {
  if (!userId || !Number.isInteger(multiplierIndex) || multiplierIndex < 0 || multiplierIndex >= MULT.length) throw new Error("Invalid slot wager");
  if (typeof reference !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(reference)) throw new Error("Invalid idempotency key");
  const bet = BASE * MULT[multiplierIndex];
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const existing = await Slot777Round.findOne({ reference }).session(session).lean();
      if (existing) {
        if (!sameRequest(existing, userId, multiplierIndex)) throw new Error("Idempotency key conflict");
        result = { success:true, duplicate:true, game:"slot777", grid:existing.grid, win:existing.win, bonus:existing.bonus, hit:existing.hit, freeSpin:existing.freeSpin, freeSpins:existing.freeSpins, balance:existing.balance, bet:existing.freeSpin ? 0 : bet };
        return;
      }
      await Wallet.updateOne({ userId }, { $setOnInsert: { balance: 0 } }, { upsert: true, session });
      await Slot777State.updateOne({ userId }, { $setOnInsert: { freeSpins: 0 } }, { upsert: true, session });
      const state = await Slot777State.findOne({ userId }).session(session);
      const freeSpin = state.freeSpins > 0;
      if (freeSpin) state.freeSpins -= 1;
      else {
        const debit = await Wallet.updateOne({ userId, balance: { $gte: bet } }, { $inc: { balance: -bet } }, { session });
        if (!debit.modifiedCount) throw new Error("Insufficient balance");
        await Ledger.create([{ userId, type:"game_debit", amount:bet, direction:"debit", reference:reference+":debit", status:"posted", metadata:{ game:"slot777", gameName:"سلوت 777", action:"spin", multiplierIndex } }], { session });
      }
      const grid = makeGrid(freeSpin);
      const outcome = evaluate(grid, bet);
      const awarded = outcome.bonus >= 3 ? (FREE[Math.min(outcome.bonus, 5)] || 10) : 0;
      state.freeSpins = Math.min(1000, state.freeSpins + awarded);
      await state.save({ session });
      if (outcome.win > 0) {
        const credit = await Wallet.updateOne({ userId }, { $inc: { balance: outcome.win } }, { session });
        if (!credit.modifiedCount) throw new Error("Unable to credit slot payout");
        await Ledger.create([{ userId, type:"game_credit", amount:outcome.win, direction:"credit", reference:reference+":credit", status:"posted", metadata:{ game:"slot777", gameName:"سلوت 777", action:"payout", multiplierIndex, freeSpin, bonus:outcome.bonus } }], { session });
      }
      const wallet = await Wallet.findOne({ userId }).select("balance").session(session).lean();
      const round = {
        userId, reference, multiplierIndex, freeSpin, grid,
        win:outcome.win, bonus:outcome.bonus, freeSpins:state.freeSpins,
        balance:wallet.balance, hit:outcome.hit
      };
      await Slot777Round.create([round], { session });
      result = { success:true, duplicate:false, game:"slot777", grid, win:outcome.win, bonus:outcome.bonus, hit:outcome.hit, freeSpin, freeSpins:state.freeSpins, balance:wallet.balance, bet:freeSpin ? 0 : bet };
    });
    return result;
  } catch (error) {
    if (error.code === 11000) throw new Error("Idempotency key conflict");
    throw error;
  } finally {
    await session.endSession();
  }
}
async function getSlot777State({ userId }) {
  const state = await Slot777State.findOne({ userId }).select("freeSpins").lean();
  return { freeSpins: state?.freeSpins || 0 };
}

module.exports = { playSlot777, getSlot777State };
