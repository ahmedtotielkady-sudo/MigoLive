const express = require("express");
const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res, next) => {
  try {
    const user = await User.findById(req.auth.sub).select("uid coins");
    if (!user) return res.status(404).json({ ok: false, message: "الحساب غير موجود" });
    await Wallet.updateOne(
      { userId: user._id },
      { $set: { balance: user.coins }, $setOnInsert: { userId: user._id } },
      { upsert: true }
    );
    return res.json({ ok: true, uid: user.uid, coins: user.coins });
  } catch (error) { return next(error); }
});

router.get("/transactions", async (req, res, next) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const rows = await WalletTransaction.find({
      $or: [{ from: req.auth.sub }, { to: req.auth.sub }]
    }).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({ ok: true, transactions: rows.map(row => ({
      id: String(row._id), type: row.type, amount: row.amount,
      direction: String(row.to) === req.auth.sub ? "in" : "out",
      description: row.description, createdAt: row.createdAt
    })) });
  } catch (error) { return next(error); }
});

router.post("/transfer", async (req, res, next) => {
  const amount = Number(req.body.amount);
  const targetUid = Number(req.body.targetUid);
  const type = req.body.type === "gift" ? "gift" : "transfer";
  const description = String(req.body.description || (type === "gift" ? "إرسال هدية" : "تحويل عملات")).slice(0, 160);
  const key = String(req.get("idempotency-key") || "");
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) {
    return res.status(400).json({ ok: false, message: "قيمة العملات غير صحيحة" });
  }
  if (!Number.isSafeInteger(targetUid) || targetUid < 100000) {
    return res.status(400).json({ ok: false, message: "رقم ID المستلم غير صحيح" });
  }
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
    return res.status(400).json({ ok: false, message: "معرّف العملية مطلوب" });
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const existing = await WalletTransaction.findOne({ idempotencyKey: key }).session(session);
      if (existing) {
        if (String(existing.from) !== req.auth.sub ||
            String(existing.to) !== String((await User.findOne({ uid: targetUid }).session(session).select("_id"))?._id || "") ||
            existing.amount !== amount || existing.type !== type) {
          throw Object.assign(new Error("مفتاح العملية مستخدم لطلب مختلف"), { status: 409 });
        }
        const sender = await User.findById(req.auth.sub).session(session).select("coins uid");
        if (!sender) throw Object.assign(new Error("الحساب غير موجود"), { status: 404 });
        result = { coins: sender.coins, transactionId: String(existing._id), repeated: true };
        return;
      }
      const recipient = await User.findOne({ uid: targetUid, status: "active" }).session(session).select("_id uid");
      if (!recipient) throw Object.assign(new Error("المستلم غير موجود أو موقوف"), { status: 404 });
      if (String(recipient._id) === req.auth.sub) throw Object.assign(new Error("لا يمكنك التحويل إلى نفسك"), { status: 400 });
      const sender = await User.findOneAndUpdate(
        { _id: req.auth.sub, status: "active", coins: { $gte: amount } },
        { $inc: { coins: -amount } },
        { new: true, session, projection: { coins: 1, uid: 1 } }
      );
      if (!sender) throw Object.assign(new Error("رصيدك غير كافٍ أو الحساب غير نشط"), { status: 409 });
      const recipientAfter = await User.findOneAndUpdate({ _id: recipient._id }, { $inc: { coins: amount } }, { new: true, session, projection: { coins: 1 } });
      await Wallet.updateOne({ userId: sender._id }, { $set: { balance: sender.coins } }, { upsert: true, session });
      await Wallet.updateOne({ userId: recipient._id }, { $set: { balance: recipientAfter.coins } }, { upsert: true, session });
      const [tx] = await WalletTransaction.create([{
        from: sender._id, to: recipient._id, amount, type, description, idempotencyKey: key
      }], { session });
      result = { coins: sender.coins, transactionId: String(tx._id), repeated: false };
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "تعذر تنفيذ التحويل"
    });
  } finally { await session.endSession(); }
});

module.exports = router;
