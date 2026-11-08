const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const Ledger = require("../models/Ledger");

async function executeTransaction({
  userId,
  amount,
  type,
  direction,
  reference,
  metadata = {}
}) {
  if (!userId || !reference) throw new Error("Missing transaction data");
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid transaction amount");
  if (!["credit", "debit"].includes(direction)) throw new Error("Invalid transaction direction");

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const existing = await Ledger.findOne({ reference }).session(session);
      if (existing) {
        result = { duplicate: true, transactionId: existing._id, amount: existing.amount, direction: existing.direction };
        return;
      }

      await Wallet.updateOne(
        { userId },
        { $setOnInsert: { balance: 0 } },
        { upsert: true, session }
      );

      const update = await Wallet.updateOne(
        direction === "debit" ? { userId, balance: { $gte: amount } } : { userId },
        { $inc: { balance: direction === "credit" ? amount : -amount } },
        { session }
      );

      if (update.modifiedCount !== 1) throw new Error("Insufficient balance");

      const [entry] = await Ledger.create([{
        userId, type, amount, direction, reference, status: "posted", metadata
      }], { session });

      result = {
        success: true,
        duplicate: false,
        transactionId: entry._id,
        amount,
        direction
      };
    });

    return result;
  } catch (error) {
    // Two simultaneous retries can race on the unique reference index.
    if (error && error.code === 11000) {
      const existing = await Ledger.findOne({ reference }).lean();
      if (existing) return { duplicate: true, transactionId: existing._id, amount: existing.amount, direction: existing.direction };
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { executeTransaction };
