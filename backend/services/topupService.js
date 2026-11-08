const mongoose = require("mongoose");
const crypto = require("crypto");
const Wallet = require("../models/Wallet");
const Ledger = require("../models/Ledger");

async function requestTopup({ userId, amount, paymentReference, receiptData, idempotencyKey }) {
  if (!userId || !idempotencyKey || !/^[A-Za-z0-9._:-]{8,100}$/.test(idempotencyKey)) {
    throw new Error("Missing or invalid top-up idempotency key");
  }
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
    throw new Error("Invalid top-up amount");
  }

  // Scope the client key and bind it to the complete request. Reusing a key
  // for a different account, amount, or payment reference is a conflict.
  const reference = "topup_req_" + idempotencyKey;
  const cleanPaymentReference = String(paymentReference || "").trim().slice(0, 100);
  const cleanReceiptData = typeof receiptData === "string" &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(receiptData) &&
    receiptData.length <= 24000 ? receiptData : "";
  if (receiptData && !cleanReceiptData) throw new Error("Invalid or oversized receipt image");
  const matches = (entry) =>
    entry &&
    String(entry.userId) === String(userId) &&
    ["topup_pending", "topup"].includes(entry.type) &&
    entry.amount === amount &&
    entry.direction === "credit" &&
    ["pending", "posted", "reversed"].includes(entry.status) &&
    String(entry.metadata?.paymentReference || "") === cleanPaymentReference &&
    String(entry.metadata?.receiptData || "") === cleanReceiptData;
  const replayStatus = (entry) => entry.status === "posted" ? "posted" : entry.status === "reversed" ? "rejected" : "pending";

  const existing = await Ledger.findOne({ reference }).lean();
  if (existing) {
    if (!matches(existing)) throw new Error("Idempotency key was already used for another top-up");
    return { success: true, duplicate: true, status: replayStatus(existing), reference, amount };
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const concurrent = await Ledger.findOne({ reference }).session(session);
      if (concurrent) {
        if (!matches(concurrent)) throw new Error("Idempotency key was already used for another top-up");
        return;
      }
      await Ledger.create([{
        userId,
        type: "topup_pending",
        amount,
        direction: "credit",
        reference,
        status: "pending",
        metadata: {
          paymentReference: cleanPaymentReference,
          receiptData: cleanReceiptData || undefined,
          requestedAt: new Date()
        }
      }], { session });
    });
    return { success: true, duplicate: false, status: "pending", reference, amount };
  } catch (error) {
    if (error.code === 11000) {
      const raced = await Ledger.findOne({ reference }).lean();
      if (matches(raced)) return { success: true, duplicate: true, status: replayStatus(raced), reference, amount };
      if (raced) throw new Error("Idempotency key was already used for another top-up");
    }
    throw error;
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
