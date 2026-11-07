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
  if (!userId || !reference) {
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
      const existing = await Ledger.findOne({
        reference
      }).session(session);

      if (existing) {
        result = { duplicate: true };
        return;
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

      await Wallet.updateOne(
        { userId },
        { $setOnInsert: { balance: 0 } },
        { upsert: true, session }
      );

      const update = await Wallet.updateOne(
        direction === "debit"
          ? { userId, balance: { $gte: amount } }
          : { userId },
        {
          $inc: {
            balance: direction === "credit"
              ? amount
              : -amount
          }
        },
        { session }
      );

      if (!update.modifiedCount) {
        throw new Error("Insufficient balance");
      }

      result = {
        success: true,
        amount,
        direction
      };
    });

    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { executeTransaction };
