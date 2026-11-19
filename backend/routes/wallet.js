const express = require("express");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);
// Apply the wallet limit per authenticated account, not per shared mobile-network IP.
// The previous IP-wide 40/minute limit was exhausted by normal wallet refreshes.
router.use(rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.auth.sub)
}));

router.get("/", async (req, res, next) => {
  try {
    const user = await User.findById(req.auth.sub).select("uid coins");
    if (!user) return res.status(404).json({ ok: false, message: "الحساب غير موجود" });
    await Wallet.updateOne(
      { userId: user._id },
      { $set: { balance: user.coins } },
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



// Owner/admin credits are committed to the canonical User balance and ledger in one transaction.
router.post("/admin/credit", async (req, res) => {
  const amount = Number(req.body.amount);
  const targetUid = Number(req.body.targetUid);
  const description = String(req.body.description || "شحن من الإدارة").slice(0, 160);
  const key = String(req.get("idempotency-key") || "");
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) {
    return res.status(400).json({ ok: false, message: "قيمة العملات غير صحيحة" });
  }
  if (!Number.isSafeInteger(targetUid) || targetUid < 100000) {
    return res.status(400).json({ ok: false, message: "رقم ID المستخدم غير صحيح" });
  }
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
    return res.status(400).json({ ok: false, message: "معرّف عملية الشحن مطلوب" });
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const admin = await User.findById(req.auth.sub).session(session).select("role status");
      if (!admin || admin.status !== "active" || !["owner", "admin"].includes(admin.role)) {
        throw Object.assign(new Error("صلاحية الشحن للإدارة فقط"), { status: 403 });
      }
      const target = await User.findOne({ uid: targetUid, status: "active" }).session(session).select("_id uid coins");
      if (!target) throw Object.assign(new Error("المستخدم غير موجود أو موقوف"), { status: 404 });

      const existing = await WalletTransaction.findOne({ idempotencyKey: key }).session(session);
      if (existing) {
        if (String(existing.from || "") !== String(admin._id) ||
            String(existing.to || "") !== String(target._id) ||
            existing.amount !== amount || existing.type !== "admin_adjustment") {
          throw Object.assign(new Error("معرّف العملية مستخدم لشحنة مختلفة"), { status: 409 });
        }
        result = { coins: target.coins, transactionId: String(existing._id), repeated: true };
        return;
      }

      const updated = await User.findOneAndUpdate(
        { _id: target._id, status: "active" },
        { $inc: { coins: amount } },
        { new: true, session, projection: { uid: 1, coins: 1 } }
      );
      if (!updated) throw Object.assign(new Error("تعذر تحديث رصيد المستخدم"), { status: 409 });
      await Wallet.updateOne(
        { userId: updated._id },
        { $set: { balance: updated.coins } },
        { upsert: true, session }
      );
      const [tx] = await WalletTransaction.create([{
        from: admin._id,
        to: updated._id,
        amount,
        type: "admin_adjustment",
        description,
        idempotencyKey: key
      }], { session });
      result = { uid: updated.uid, coins: updated.coins, transactionId: String(tx._id), repeated: false };
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "تعذر تنفيذ شحن الإدارة"
    });
  } finally {
    await session.endSession();
  }
});


// Owner-only debits require a positive amount, an explicit reason and an
// idempotency key. The user balance and audit ledger commit atomically.
router.post("/admin/debit", async (req, res) => {
  const amount = Number(req.body.amount);
  const targetUid = Number(req.body.targetUid);
  const description = String(req.body.description || "").trim().slice(0, 160);
  const key = String(req.get("idempotency-key") || "");
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000) {
    return res.status(400).json({ ok: false, message: "قيمة الخصم غير صحيحة" });
  }
  if (!Number.isSafeInteger(targetUid) || targetUid < 100000) {
    return res.status(400).json({ ok: false, message: "رقم ID المستخدم غير صحيح" });
  }
  if (!description) {
    return res.status(400).json({ ok: false, message: "سبب الخصم مطلوب" });
  }
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) {
    return res.status(400).json({ ok: false, message: "معرّف عملية الخصم مطلوب" });
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const admin = await User.findById(req.auth.sub).session(session).select("role status");
      if (!admin || admin.status !== "active" || !["owner", "admin"].includes(admin.role)) {
        throw Object.assign(new Error("صلاحية الخصم للإدارة فقط"), { status: 403 });
      }
      const target = await User.findOne({ uid: targetUid, status: "active" })
        .session(session).select("_id uid coins");
      if (!target) throw Object.assign(new Error("المستخدم غير موجود أو موقوف"), { status: 404 });

      const existing = await WalletTransaction.findOne({ idempotencyKey: key }).session(session);
      if (existing) {
        if (String(existing.from || "") !== String(target._id) ||
            String(existing.to || "") !== String(admin._id) ||
            existing.amount !== amount || existing.type !== "admin_adjustment" ||
            existing.description !== description) {
          throw Object.assign(new Error("معرّف العملية مستخدم لخصم مختلف"), { status: 409 });
        }
        const current = await User.findById(target._id).session(session).select("uid coins");
        result = { uid: current.uid, coins: current.coins, transactionId: String(existing._id), repeated: true };
        return;
      }

      const updated = await User.findOneAndUpdate(
        { _id: target._id, status: "active", coins: { $gte: amount } },
        { $inc: { coins: -amount } },
        { new: true, session, projection: { uid: 1, coins: 1 } }
      );
      if (!updated) throw Object.assign(new Error("رصيد المستخدم غير كافٍ"), { status: 409 });
      await Wallet.updateOne(
        { userId: updated._id },
        { $set: { balance: updated.coins } },
        { upsert: true, session }
      );
      const [tx] = await WalletTransaction.create([{
        from: updated._id,
        to: admin._id,
        amount,
        type: "admin_adjustment",
        description,
        idempotencyKey: key
      }], { session });
      result = { uid: updated.uid, coins: updated.coins, transactionId: String(tx._id), repeated: false };
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({
      ok: false,
      message: error.status ? error.message : "تعذر تنفيذ الخصم"
    });
  } finally {
    await session.endSession();
  }
});


// Owner/admin credit or debit by immutable numeric user ID only.
router.post("/admin/adjust", async (req, res) => {
  const targetUid = Number(req.body.targetUid);
  const signedAmount = Number(req.body.amount);
  const description = String(req.body.description || (signedAmount < 0 ? "خصم من الإدارة" : "شحن من الإدارة")).trim().slice(0, 160);
  const key = String(req.get("idempotency-key") || "");
  if (!Number.isSafeInteger(targetUid) || targetUid < 100000) return res.status(400).json({ ok: false, message: "رقم ID المستخدم غير صحيح" });
  if (!Number.isSafeInteger(signedAmount) || signedAmount === 0 || Math.abs(signedAmount) > 1000000000) return res.status(400).json({ ok: false, message: "العدد يجب أن يكون صحيحًا وغير صفر" });
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) return res.status(400).json({ ok: false, message: "معرّف العملية مطلوب" });
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const admin = await User.findById(req.auth.sub).session(session).select("role status");
      if (!admin || admin.status !== "active" || !["owner", "admin"].includes(admin.role)) throw Object.assign(new Error("صلاحية التعديل للإدارة فقط"), { status: 403 });
      const target = await User.findOne({ uid: targetUid, status: "active" }).session(session).select("_id uid coins username");
      if (!target) throw Object.assign(new Error("رقم ID غير موجود أو الحساب موقوف"), { status: 404 });
      const type = signedAmount < 0 ? "admin_deduction" : "admin_adjustment";
      const amount = Math.abs(signedAmount);
      const existing = await WalletTransaction.findOne({ idempotencyKey: key }).session(session);
      if (existing) {
        if (String(existing.from || "") !== String(admin._id) || String(existing.to || "") !== String(target._id) || existing.amount !== amount || existing.type !== type || existing.description !== description) throw Object.assign(new Error("معرّف العملية مستخدم لطلب مختلف"), { status: 409 });
        const current = await User.findById(target._id).session(session).select("uid coins username");
        result = { username: current.username, uid: current.uid, coins: current.coins, transactionId: String(existing._id), repeated: true };
        return;
      }
      const updated = await User.findOneAndUpdate(
        { _id: target._id, status: "active", ...(signedAmount < 0 ? { coins: { $gte: amount } } : {}) },
        { $inc: { coins: signedAmount } },
        { new: true, session, projection: { uid: 1, username: 1, coins: 1 } }
      );
      if (!updated) throw Object.assign(new Error("الرصيد غير كافٍ لإتمام الخصم"), { status: 409 });
      await Wallet.updateOne({ userId: updated._id }, { $set: { balance: updated.coins } }, { upsert: true, session });
      const [tx] = await WalletTransaction.create([{
        from: admin._id, to: updated._id, amount, type, description, idempotencyKey: key
      }], { session });
      result = { username: updated.username, uid: updated.uid, coins: updated.coins, transactionId: String(tx._id), repeated: false };
    });
    return res.json({ ok: true, ...result });
  } catch (error) {
    if (error && error.code === 11000) {
      try {
        const [existing, admin, target] = await Promise.all([
          WalletTransaction.findOne({ idempotencyKey: key }).lean(),
          User.findById(req.auth.sub).select("_id role status").lean(),
          User.findOne({ uid: targetUid }).select("_id uid username coins").lean()
        ]);
        const type = signedAmount < 0 ? "admin_deduction" : "admin_adjustment";
        if (existing && admin && target && admin.status === "active" && ["owner", "admin"].includes(admin.role) && String(existing.from || "") === String(admin._id) && String(existing.to || "") === String(target._id) && existing.amount === Math.abs(signedAmount) && existing.type === type && existing.description === description) return res.json({ ok: true, username: target.username, uid: target.uid, coins: target.coins, transactionId: String(existing._id), repeated: true });
        return res.status(409).json({ ok: false, message: "معرّف العملية مستخدم بالفعل" });
      } catch (_) { return res.status(503).json({ ok: false, message: "تعذر التحقق من نتيجة العملية؛ أعد المحاولة بنفس المعرّف" }); }
    }
    return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر تنفيذ تعديل الرصيد" });
  } finally { await session.endSession(); }
});

module.exports = router;
