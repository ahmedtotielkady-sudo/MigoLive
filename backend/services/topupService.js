const mongoose = require("mongoose");
const crypto = require("crypto");
const Wallet = require("../models/Wallet");
const Ledger = require("../models/Ledger");

async function requestTopup({ userId, amount, paymentReference }) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
    throw new Error("Invalid top-up amount");
  }
  const reference = "topup_req_" + crypto.randomUUID();
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Ledger.create([{
        userId,
        type: "topup_pending",
        amount,
        direction: "credit",
        reference,
        status: "pending",
        metadata: {
          paymentReference: String(paymentReference || "").trim().slice(0, 100),
          requestedAt: new Date()
        }
      }], { session });
    });
    return { success: true, status: "pending", reference, amount };
  } finally {
    await session.endSession();
  }
}

async function reviewTopup({ reference, reviewerId, approve, note = "" }) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      const entry = await Ledger.findOne({
        reference,
        type: "topup_pending",
        status: "pending",
        direction: "credit"
      }).session(session);
      if (!entry) throw new Error("Pending top-up not found");

      if (!approve) {
        entry.status = "reversed";
        entry.metadata = {
          ...(entry.metadata || {}),
          reviewedBy: reviewerId,
          reviewedAt: new Date(),
          reviewNote: String(note).trim().slice(0, 300)
        };
        await entry.save({ session });
        result = { success: true, status: "rejected", reference, amount: entry.amount };
        return;
      }

      await Wallet.updateOne(
        { userId: entry.userId },
        { $setOnInsert: { balance: 0 } },
        { upsert: true, session }
      );
      const credit = await Wallet.updateOne(
        { userId: entry.userId },
        { $inc: { balance: entry.amount } },
        { session }
      );
      if (!credit.modifiedCount) throw new Error("Unable to credit wallet");

      entry.type = "topup";
      entry.status = "posted";
      entry.metadata = {
        ...(entry.metadata || {}),
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNote: String(note).trim().slice(0, 300)
      };
      await entry.save({ session });
      result = { success: true, status: "posted", reference, amount: entry.amount };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

module.exports = { requestTopup, reviewTopup };
