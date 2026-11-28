const express = require("express");
const mongoose = require("mongoose");
const crypto = require("crypto");
const User = require("../models/User");
const Room = require("../models/Room");
const WalletTransaction = require("../models/WalletTransaction");
const Wallet = require("../models/Wallet");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

function requestFingerprint(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
router.use(requireAuth);

// Prices are authoritative on the server; clients may send only giftId and recipientUid.
const GIFTS = Object.freeze([
  { id: "rose", name: "وردة", coins: 10, emoji: "🌹" },
  { id: "heart", name: "قلب", coins: 25, emoji: "💖" },
  { id: "coffee", name: "قهوة", coins: 50, emoji: "☕" },
  { id: "crown", name: "تاج", coins: 250, emoji: "👑" },
  { id: "diamond", name: "ماسة", coins: 1000, emoji: "💎" }
]);

router.get("/catalog", (_req, res) => res.json({ ok: true, gifts: GIFTS }));

router.post("/send", async (req, res) => {
  const gift = GIFTS.find(item => item.id === String(req.body.giftId || ""));
  const recipientUid = Number(req.body.recipientUid);
  const roomCode = Number(req.body.roomCode);
  const key = String(req.get("idempotency-key") || "");
  const requestHash = requestFingerprint({ action: "gift", senderId: String(req.auth.sub), recipientUid, roomCode, giftId: gift && gift.id, coins: gift && gift.coins });
  if (!gift) return res.status(400).json({ ok: false, message: "الهدية غير معروفة" });
  if (!Number.isSafeInteger(recipientUid) || recipientUid < 100000) {
    return res.status(400).json({ ok: false, message: "رقم المستلم غير صحيح" });
  }
  if (!Number.isSafeInteger(roomCode)) return res.status(400).json({ ok: false, message: "رقم الغرفة مطلوب" });
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
    return res.status(400).json({ ok: false, message: "معرّف العملية مطلوب" });
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const existing = await WalletTransaction.findOne({ idempotencyKey: key }).session(session);
      if (existing) {
        const recipientForReplay = await User.findOne({ uid: recipientUid }).session(session).select("_id");
        if (String(existing.from) !== req.auth.sub || String(existing.to) !== String(recipientForReplay?._id || "") ||
            existing.amount !== gift.coins || existing.type !== "gift" || existing.description !== gift.name || (existing.requestHash && existing.requestHash !== requestHash)) {
          throw Object.assign(new Error("معرّف العملية مستخدم لطلب مختلف"), { status: 409 });
        }
        const sender = await User.findById(req.auth.sub).session(session).select("coins");
        if (!sender) throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
        result = { coins: sender.coins, transactionId: String(existing._id), repeated: true };
        return;
      }

      const recipient = await User.findOne({ uid: recipientUid, status: "active" }).session(session).select("_id uid displayName");
      if (!recipient) throw Object.assign(new Error("المستلم غير موجود"), { status: 404 });
      if (String(recipient._id) === req.auth.sub) throw Object.assign(new Error("لا يمكنك إهداء نفسك"), { status: 400 });
      const room = await Room.findOne({ roomCode, status: "open", members: { $all: [req.auth.sub, recipient._id] } }).session(session).select("_id");
      if (!room) throw Object.assign(new Error("يجب أن تكون أنت والمستلم داخل الغرفة"), { status: 403 });

      const sender = await User.findOneAndUpdate(
        { _id: req.auth.sub, status: "active", coins: { $gte: gift.coins } },
        { $inc: { coins: -gift.coins } },
        { new: true, session, projection: { coins: 1 } }
      );
      if (!sender) throw Object.assign(new Error("رصيدك غير كافٍ"), { status: 409 });
      const recipientAfter = await User.findOneAndUpdate({ _id: recipient._id }, { $inc: { coins: gift.coins } }, { new: true, session, projection: { coins: 1 } });
      await Wallet.updateOne({ userId: sender._id }, { $set: { balance: sender.coins } }, { upsert: true, session });
      await Wallet.updateOne({ userId: recipient._id }, { $set: { balance: recipientAfter.coins } }, { upsert: true, session });
      const [tx] = await WalletTransaction.create([{
        from: req.auth.sub, to: recipient._id, amount: gift.coins, type: "gift",
        description: gift.name, idempotencyKey: key, requestHash
      }], { session });
      result = { coins: sender.coins, transactionId: String(tx._id), repeated: false };
    });
    return res.status(200).json({ ok: true, gift, recipientUid, roomCode, ...result });
  } catch (error) {
    // Two concurrent retries can both pass the initial lookup. The unique
    // idempotency index lets only one transaction commit; recover the winner.
    if (error && error.code === 11000) {
      try {
        const [existing, sender, recipient] = await Promise.all([
          WalletTransaction.findOne({ idempotencyKey: key }).lean(),
          User.findById(req.auth.sub).select("coins").lean(),
          User.findOne({ uid: recipientUid }).select("_id").lean()
        ]);
        if (existing && sender && recipient &&
            String(existing.from) === String(req.auth.sub) &&
            String(existing.to) === String(recipient._id) &&
            existing.amount === gift.coins && existing.type === "gift" &&
            existing.description === gift.name &&
            (!existing.requestHash || existing.requestHash === requestHash)) {
          return res.status(200).json({
            ok: true, gift, recipientUid, roomCode, coins: sender.coins,
            transactionId: String(existing._id), repeated: true
          });
        }
        return res.status(409).json({ ok: false, message: "معرّف العملية مستخدم لطلب مختلف" });
      } catch (_recoveryError) {
        return res.status(503).json({ ok: false, message: "تعذر تأكيد نتيجة الهدية؛ أعد المحاولة بنفس المعرّف" });
      }
    }
    return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر إرسال الهدية" });
  } finally { await session.endSession(); }
});

module.exports = router;
