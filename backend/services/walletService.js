const mongoose = require("mongoose");
const Wallet = require("../models/Wallet");
const Ledger = require("../models/Ledger");
const User = require("../models/User");

async function executeTransaction({
  userId,
  amount,
  type,
  direction,
  reference,
  metadata = {}
}) {
  if (!userId || !reference || !type) throw new Error("Missing transaction data");
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid transaction amount");
  if (!["credit", "debit"].includes(direction)) throw new Error("Invalid transaction direction");

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
          existing.status === "posted" &&
          (existing.metadata?.game || null) === (metadata?.game || null) &&
          (existing.metadata?.action || null) === (metadata?.action || null) &&
          (existing.metadata?.actorId || null) === (metadata?.actorId || null) &&
          (existing.metadata?.reason || null) === (metadata?.reason || null);

        if (!sameRequest) throw new Error("Idempotency key was already used for another transaction");
        result = { success: true, duplicate: true, amount, direction, reference };
        return;
      }

      await Wallet.updateOne({ userId }, { $setOnInsert: { balance: 0 } }, { upsert: true, session });
      const update = await Wallet.updateOne(
        direction === "debit" ? { userId, balance: { $gte: amount } } : { userId },
        { $inc: { balance: direction === "credit" ? amount : -amount } },
        { session }
      );
      if (!update.modifiedCount) throw new Error("Insufficient balance");

      await Ledger.create([{
        userId, type, amount, direction, reference, status: "posted", metadata
      }], { session });

      result = { success: true, duplicate: false, amount, direction, reference };
    });
    return result;
  } catch (error) {
    if (error.code === 11000) {
      const existing = await Ledger.findOne({ reference }).lean();
      if (existing) {
        const sameRequest =
          String(existing.userId) === String(userId) &&
          existing.amount === amount &&
          existing.type === type &&
          existing.direction === direction &&
          existing.status === "posted" &&
          (existing.metadata?.game || null) === (metadata?.game || null) &&
          (existing.metadata?.action || null) === (metadata?.action || null) &&
          (existing.metadata?.actorId || null) === (metadata?.actorId || null) &&
          (existing.metadata?.reason || null) === (metadata?.reason || null);
        if (!sameRequest) throw new Error("Idempotency key was already used for another transaction");
        return { success: true, duplicate: true, amount, direction, reference };
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

async function executeGiftTransfer({ senderId, recipientUsername, recipientLegacyUid, amount, reference }) {
  if (!senderId || (!recipientUsername && !recipientLegacyUid) || !reference) throw new Error("Missing gift data");
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
    throw new Error("Invalid gift amount");
  }
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(reference)) throw new Error("Invalid idempotency key");

  const recipientFilter = recipientLegacyUid
    ? { legacyUid: String(recipientLegacyUid), status: "active" }
    : { username: String(recipientUsername).trim(), status: "active" };
  const recipient = await User.findOne(recipientFilter).select("_id username legacyUid");

  if (!recipient) throw new Error("Recipient not found");
  if (String(recipient._id) === String(senderId)) throw new Error("Cannot gift yourself");

  const debitRef = reference + ":debit";
  const creditRef = reference + ":credit";
  const session = await mongoose.startSession();

  try {
    let duplicate = false;
    await session.withTransaction(async () => {
      const debitExisting = await Ledger.findOne({ reference: debitRef }).session(session);
      const creditExisting = await Ledger.findOne({ reference: creditRef }).session(session);

      if (debitExisting || creditExisting) {
        const valid =
          debitExisting && creditExisting &&
          String(debitExisting.userId) === String(senderId) &&
          String(creditExisting.userId) === String(recipient._id) &&
          debitExisting.amount === amount &&
          creditExisting.amount === amount &&
          debitExisting.type === "gift_debit" &&
          creditExisting.type === "gift_credit" &&
          debitExisting.direction === "debit" &&
          creditExisting.direction === "credit" &&
          debitExisting.status === "posted" &&
          creditExisting.status === "posted" &&
          String(debitExisting.metadata?.recipientId) === String(recipient._id) &&
          String(creditExisting.metadata?.senderId) === String(senderId);
        if (!valid) throw new Error("Idempotency key was already used for another gift");
        duplicate = true;
        return;
      }

      const sender = await User.findOne({ _id: senderId, status: "active" }).select("username").session(session);
      const activeRecipient = await User.findOne({ _id: recipient._id, status: "active" }).select("_id username").session(session);
      if (!sender) throw new Error("Sender not found");
      if (!activeRecipient) throw new Error("Recipient not found");

      await Wallet.updateOne({ userId: senderId }, { $setOnInsert: { balance: 0 } }, { upsert: true, session });
      await Wallet.updateOne({ userId: recipient._id }, { $setOnInsert: { balance: 0 } }, { upsert: true, session });

      const debit = await Wallet.updateOne(
        { userId: senderId, balance: { $gte: amount } },
        { $inc: { balance: -amount } },
        { session }
      );
      if (!debit.modifiedCount) throw new Error("Insufficient balance");

      const credit = await Wallet.updateOne(
        { userId: recipient._id },
        { $inc: { balance: amount } },
        { session }
      );
      if (!credit.modifiedCount) throw new Error("Unable to credit recipient wallet");

      await Ledger.create([
        {
          userId: senderId, type: "gift_debit", amount, direction: "debit",
          reference: debitRef, status: "posted",
          metadata: { recipientId: activeRecipient._id, recipientUsername: activeRecipient.username }
        },
        {
          userId: recipient._id, type: "gift_credit", amount, direction: "credit",
          reference: creditRef, status: "posted",
          metadata: { senderId, senderUsername: sender.username }
        }
      ], { session });
    });

    return { success: true, duplicate, amount, recipient: recipient.username, reference };
  } catch (error) {
    if (error.code === 11000) {
      const [debit, credit] = await Promise.all([
        Ledger.findOne({ reference: debitRef }).lean(),
        Ledger.findOne({ reference: creditRef }).lean()
      ]);
      if (
        debit && credit &&
        String(debit.userId) === String(senderId) &&
        String(credit.userId) === String(recipient._id) &&
        debit.amount === amount && credit.amount === amount &&
        debit.direction === "debit" && credit.direction === "credit" &&
        debit.status === "posted" && credit.status === "posted" &&
        String(debit.metadata?.recipientId) === String(recipient._id) &&
        String(credit.metadata?.senderId) === String(senderId)
      ) {
        return { success: true, duplicate: true, amount, recipient: recipient.username, reference };
      }
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

module.exports = { executeTransaction, executeGiftTransfer };
