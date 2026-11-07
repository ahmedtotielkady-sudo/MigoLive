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
  if (!userId || !reference || !type) {
    throw new Error("Missing transaction data");
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error("Invalid transaction amount");
  }

  if (!["credit", "debit"].includes(direction)) {
    throw new Error("Invalid transaction direction");
  }

  const session = await mongoose.startSession();
  let result;

  try {
    await session.withTransaction(async () => {
      const existing = await Ledger.findOne({ reference }).session(session);

      if (existing) {
        const sameRequest =
          String(existing.userId) === String(userId) &&
          existing.amount === amount &&
          existing.type === type &&
          existing.direction === direction &&
          (existing.metadata?.game || null) === (metadata?.game || null);

        if (!sameRequest) {
          throw new Error("Idempotency key was already used for another transaction");
        }

        result = {
          success: true,
          duplicate: true,
          amount: existing.amount,
          direction: existing.direction,
          reference: existing.reference
        };
        return;
      }

      await Wallet.updateOne(
        { userId },
        { $setOnInsert: { balance: 0 } },
        { upsert: true, session }
      );

      const walletUpdate = await Wallet.updateOne(
        direction === "debit"
          ? { userId, balance: { $gte: amount } }
          : { userId },
        { $inc: { balance: direction === "credit" ? amount : -amount } },
        { session }
      );

      if (!walletUpdate.modifiedCount) {
        throw new Error("Insufficient balance");
      }

      await Ledger.create([{
        userId,
        type,
        amount,
        direction,
        reference,
        status: "posted",
        metadata
      }], { session });

      result = { success: true, duplicate: false, amount, direction, reference };
    });

    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { executeTransaction };
