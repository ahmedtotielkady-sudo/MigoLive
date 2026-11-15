const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Room = require("../models/Room");
const WalletTransaction = require("../models/WalletTransaction");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
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
      const recipient = await User.findOne({ uid: recipientUid, status: "active" }).session(session).select("_id uid displayName");
      if (!recipient) throw Object.assign(new Error("المستلم غير موجود"), { status: 404 });
      if (String(recipient._id) === req.auth.sub) throw Object.assign(new Error("لا يمكنك إهداء نفسك"), { status: 400 });
      const room = await Room.findOne({ roomCode, status: "open", members: { $all: [req.auth.sub, recipient._id] } }).session(session).select("_id");
      if (!room) throw Object.assign(new Error("يجب أن تكون أنت والمستلم داخل الغرفة"), { status: 403 });

      if (existing) {
        if (String(existing.from) !== req.auth.sub || String(existing.to) !== String(recipient._id) ||
            existing.amount !== gift.coins || existing.type !== "gift" || existing.description !== gift.name) {
          throw Object.assign(new Error("معرّف العملية مستخدم لطلب مختلف"), { status: 409 });
        }
        const sender = await User.findById(req.auth.sub).session(session).select("coins");
        result = { coins: sender.coins, transactionId: String(existing._id), repeated: true };
        return;
      }

      const sender = await User.findOneAndUpdate(
        { _id: req.auth.sub, status: "active", coins: { $gte: gift.coins } },
        { $inc: { coins: -gift.coins } },
        { new: true, session, projection: { coins: 1 } }
      );
      if (!sender) throw Object.assign(new Error("رصيدك غير كافٍ"), { status: 409 });
      await User.updateOne({ _id: recipient._id }, { $inc: { coins: gift.coins } }, { session });
      const [tx] = await WalletTransaction.create([{
        from: req.auth.sub, to: recipient._id, amount: gift.coins, type: "gift",
        description: gift.name, idempotencyKey: key
      }], { session });
      result = { coins: sender.coins, transactionId: String(tx._id), repeated: false };
    });
    return res.status(200).json({ ok: true, gift, recipientUid, roomCode, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر إرسال الهدية" });
  } finally { await session.endSession(); }
});

module.exports = router;
