"use strict";
const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const requireAuth = require("../middleware/requireAuth");
const User = require("../models/User");
const Agency = require("../models/Agency");
const AgencyMembership = require("../models/AgencyMembership");
const AgencyLedger = require("../models/AgencyLedger");
const AdminAuditLog = require("../models/AdminAuditLog");
const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");

const router = express.Router();
router.use(requireAuth);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
function idempotencyKey(req) {
  const key = String(req.get("idempotency-key") || "");
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) throw httpError(400, "معرّف العملية مطلوب");
  return key;
}
async function activeActor(userId, session) {
  let query = User.findById(userId).select("_id uid role status");
  if (session) query = query.session(session);
  const actor = await query.lean();
  if (!actor || actor.status !== "active") throw httpError(401, "الحساب غير نشط");
  return actor;
}
async function requireOwner(userId, session) {
  const actor = await activeActor(userId, session);
  if (actor.role !== "owner") throw httpError(403, "هذه العملية متاحة لمالك التطبيق فقط");
  return actor;
}
async function agencyAccess(userId, agency, allowedTypes) {
  const actor = await activeActor(userId);
  if (actor.role === "owner") return { actor, membership: null };
  const membership = await AgencyMembership.findOne({
    agencyId: agency._id, userId, status: "active",
    ...(allowedTypes ? { memberType: { $in: allowedTypes } } : {})
  }).lean();
  if (!membership) throw httpError(403, "ليس لديك صلاحية على هذه الوكالة");
  return { actor, membership };
}
function validObjectId(value) { return mongoose.isValidObjectId(value); }
function safeAgency(agency) {
  return {
    id: String(agency._id), agencyCode: agency.agencyCode, name: agency.name,
    type: agency.type, status: agency.status, managerUserId: String(agency.managerUserId),
    balanceCoins: agency.balanceCoins, creditLimitCoins: agency.creditLimitCoins,
    monthlyTargetCoins: agency.monthlyTargetCoins, setupFeeMinor: agency.setupFeeMinor,
    currency: agency.currency, graceDays: agency.graceDays, renewalAt: agency.renewalAt,
    packages: agency.packages, createdAt: agency.createdAt, updatedAt: agency.updatedAt
  };
}
async function audit(session, actor, action, targetType, targetId, reason, metadata = {}) {
  await AdminAuditLog.create([{
    actorUserId: actor._id, action, targetType, targetId: String(targetId),
    reason: String(reason || "").slice(0, 500), metadata
  }], { session });
}

// Owner-only central registry.
router.get("/owner", async (req, res, next) => {
  try {
    await requireOwner(req.auth.sub);
    const type = ["host", "recharge"].includes(String(req.query.type || "")) ? String(req.query.type) : null;
    const status = ["pending", "active", "suspended", "closed"].includes(String(req.query.status || "")) ? String(req.query.status) : null;
    const filter = {};
    if (type) filter.type = type;
    if (status) filter.status = status;
    const agencies = await Agency.find(filter).sort({ createdAt: -1 }).limit(500).lean();
    const ids = agencies.map(a => a._id);
    const counts = await AgencyMembership.aggregate([
      { $match: { agencyId: { $in: ids }, status: "active" } },
      { $group: { _id: "$agencyId", members: { $sum: 1 }, hosts: { $sum: { $cond: [{ $eq: ["$memberType", "host"] }, 1, 0] } }, distributors: { $sum: { $cond: [{ $eq: ["$memberType", "distributor"] }, 1, 0] } } } }
    ]);
    const byId = new Map(counts.map(row => [String(row._id), row]));
    return res.json({ ok: true, agencies: agencies.map(a => ({ ...safeAgency(a), counts: byId.get(String(a._id)) || { members: 0, hosts: 0, distributors: 0 } })) });
  } catch (error) { return next(error); }
});

router.post("/owner", async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    let created;
    await session.withTransaction(async () => {
      const actor = await requireOwner(req.auth.sub, session);
      const type = String(req.body.type || "");
      const name = String(req.body.name || "").normalize("NFKC").trim();
      const managerUid = Number(req.body.managerUid);
      if (!["host", "recharge"].includes(type)) throw httpError(400, "نوع الوكالة غير صحيح");
      if (name.length < 2 || name.length > 80) throw httpError(400, "اسم الوكالة يجب أن يكون من حرفين إلى 80 حرفًا");
      if (!Number.isSafeInteger(managerUid) || managerUid < 1) throw httpError(400, "رقم مدير الوكالة غير صحيح");
      const manager = await User.findOne({ uid: managerUid, status: "active" }).session(session).select("_id uid");
      if (!manager) throw httpError(404, "مدير الوكالة غير موجود أو موقوف");
      const code = "MG-" + crypto.randomBytes(5).toString("hex").toUpperCase();
      const [agency] = await Agency.create([{
        agencyCode: code, name, type, managerUserId: manager._id,
        monthlyTargetCoins: Math.max(0, Number(req.body.monthlyTargetCoins) || 0),
        creditLimitCoins: type === "recharge" ? Math.max(0, Number(req.body.creditLimitCoins) || 0) : 0,
        setupFeeMinor: Math.max(0, Number(req.body.setupFeeMinor) || 0),
        currency: String(req.body.currency || "EGP").toUpperCase(),
        graceDays: Number.isInteger(Number(req.body.graceDays)) ? Math.min(365, Math.max(0, Number(req.body.graceDays))) : 30,
        createdBy: actor._id
      }], { session });
      await AgencyMembership.create([{
        agencyId: agency._id, userId: manager._id, memberType: "manager",
        status: "active", invitedBy: actor._id
      }], { session });
      await audit(session, actor, "agency.created", "agency", agency._id, req.body.reason || "إنشاء وكالة", { type, agencyCode: code, managerUid });
      created = safeAgency(agency);
    });
    return res.status(201).json({ ok: true, agency: created });
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر إنشاء الوكالة" });
  } finally { await session.endSession(); }
});

router.patch("/owner/:agencyId", async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const actor = await requireOwner(req.auth.sub, session);
      if (!validObjectId(req.params.agencyId)) throw httpError(400, "معرّف الوكالة غير صحيح");
      const agency = await Agency.findById(req.params.agencyId).session(session);
      if (!agency) throw httpError(404, "الوكالة غير موجودة");
      const body = req.body || {};
      const allowed = ["name", "status", "monthlyTargetCoins", "creditLimitCoins", "setupFeeMinor", "currency", "graceDays", "renewalAt", "packages"];
      const changed = {};
      for (const key of allowed) if (Object.prototype.hasOwnProperty.call(body, key)) changed[key] = body[key];
      if (!Object.keys(changed).length) throw httpError(400, "لا توجد تغييرات صالحة");
      if (Object.prototype.hasOwnProperty.call(changed, "name")) {
        changed.name = String(changed.name || "").normalize("NFKC").trim();
        if (changed.name.length < 2 || changed.name.length > 80) throw httpError(400, "اسم الوكالة غير صحيح");
      }
      if (Object.prototype.hasOwnProperty.call(changed, "status") && !["pending", "active", "suspended", "closed"].includes(changed.status)) throw httpError(400, "حالة الوكالة غير صحيحة");
      for (const key of ["monthlyTargetCoins", "creditLimitCoins", "setupFeeMinor"]) {
        if (Object.prototype.hasOwnProperty.call(changed, key)) {
          const n = Number(changed[key]);
          if (!Number.isSafeInteger(n) || n < 0) throw httpError(400, "قيمة مالية غير صحيحة: " + key);
          changed[key] = n;
        }
      }
      if (Object.prototype.hasOwnProperty.call(changed, "graceDays")) {
        const n = Number(changed.graceDays);
        if (!Number.isInteger(n) || n < 0 || n > 365) throw httpError(400, "فترة السماح غير صحيحة");
        changed.graceDays = n;
      }
      if (Object.prototype.hasOwnProperty.call(changed, "currency")) {
        changed.currency = String(changed.currency).toUpperCase();
        if (!/^[A-Z]{3}$/.test(changed.currency)) throw httpError(400, "رمز العملة غير صحيح");
      }
      if (Object.prototype.hasOwnProperty.call(changed, "packages")) {
        if (!Array.isArray(changed.packages) || changed.packages.length > 30) throw httpError(400, "قائمة الباقات غير صحيحة");
        changed.packages = changed.packages.map(p => ({
          packageId: String(p.packageId || "").trim(),
          coins: Number(p.coins), priceMinor: Number(p.priceMinor),
          currency: String(p.currency || agency.currency).toUpperCase(),
          commissionRateBps: Number(p.commissionRateBps || 0), active: p.active !== false
        }));
        for (const p of changed.packages) {
          if (!/^[A-Za-z0-9_-]{1,40}$/.test(p.packageId) || !Number.isSafeInteger(p.coins) || p.coins < 1 ||
              !Number.isSafeInteger(p.priceMinor) || p.priceMinor < 0 || !/^[A-Z]{3}$/.test(p.currency) ||
              !Number.isInteger(p.commissionRateBps) || p.commissionRateBps < 0 || p.commissionRateBps > 10000) {
            throw httpError(400, "بيانات إحدى الباقات غير صحيحة");
          }
        }
        if (new Set(changed.packages.map(p => p.packageId)).size !== changed.packages.length) throw httpError(409, "معرّف الباقة مكرر");
      }
      Object.assign(agency, changed);
      await agency.save({ session });
      await audit(session, actor, "agency.updated", "agency", agency._id, body.reason || "تعديل إعدادات الوكالة", { changedFields: Object.keys(changed) });
      result = safeAgency(agency);
    });
    return res.json({ ok: true, agency: result });
  } catch (error) { return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر تعديل الوكالة" }); }
  finally { await session.endSession(); }
});

router.post("/owner/:agencyId/credit", async (req, res) => {
  const amountCoins = Number(req.body.amountCoins);
  const reason = String(req.body.reason || "").trim().slice(0, 240);
  let key;
  try { key = idempotencyKey(req); } catch (error) { return res.status(error.status).json({ ok: false, message: error.message }); }
  if (!Number.isSafeInteger(amountCoins) || amountCoins < 1 || amountCoins > 1000000000) return res.status(400).json({ ok: false, message: "قيمة الرصيد غير صحيحة" });
  if (!reason) return res.status(400).json({ ok: false, message: "سبب إضافة الرصيد مطلوب" });
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const actor = await requireOwner(req.auth.sub, session);
      if (!validObjectId(req.params.agencyId)) throw httpError(400, "معرّف الوكالة غير صحيح");
      const existing = await AgencyLedger.findOne({ idempotencyKey: key }).session(session);
      if (existing) {
        if (String(existing.agencyId) !== req.params.agencyId || existing.type !== "owner_credit" || existing.amountCoins !== amountCoins) throw httpError(409, "معرّف العملية مستخدم لطلب مختلف");
        const current = await Agency.findById(existing.agencyId).session(session);
        result = { agency: safeAgency(current), transactionId: String(existing._id), repeated: true };
        return;
      }
      const agency = await Agency.findById(req.params.agencyId).session(session);
      if (!agency || agency.type !== "recharge") throw httpError(404, "وكالة الشحن غير موجودة");
      if (agency.status !== "active") throw httpError(409, "الوكالة غير نشطة");
      const before = agency.balanceCoins;
      agency.balanceCoins += amountCoins;
      await agency.save({ session });
      const [entry] = await AgencyLedger.create([{
        agencyId: agency._id, actorUserId: actor._id, type: "owner_credit",
        direction: "credit", amountCoins, balanceBefore: before, balanceAfter: agency.balanceCoins,
        currency: agency.currency, description: reason, idempotencyKey: key
      }], { session });
      await audit(session, actor, "agency.balance.credit", "agency", agency._id, reason, { amountCoins, before, after: agency.balanceCoins, ledgerId: String(entry._id) });
      result = { agency: safeAgency(agency), transactionId: String(entry._id), repeated: false };
    });
    return res.json({ ok: true, ...result });
  } catch (error) { return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر إضافة رصيد الوكالة" }); }
  finally { await session.endSession(); }
});

router.get("/mine", async (req, res, next) => {
  try {
    await activeActor(req.auth.sub);
    const memberships = await AgencyMembership.find({ userId: req.auth.sub, status: "active" }).populate("agencyId").lean();
    return res.json({ ok: true, agencies: memberships.filter(m => m.agencyId).map(m => ({ membership: { type: m.memberType, permissions: m.permissions }, agency: safeAgency(m.agencyId) })) });
  } catch (error) { return next(error); }
});

router.get("/:agencyId/members", async (req, res, next) => {
  try {
    if (!validObjectId(req.params.agencyId)) return res.status(400).json({ ok: false, message: "معرّف الوكالة غير صحيح" });
    const agency = await Agency.findById(req.params.agencyId).lean();
    if (!agency) return res.status(404).json({ ok: false, message: "الوكالة غير موجودة" });
    await agencyAccess(req.auth.sub, agency);
    const rows = await AgencyMembership.find({ agencyId: agency._id, status: { $ne: "removed" } })
      .populate("userId", "uid username displayName avatar status").sort({ createdAt: -1 }).limit(500).lean();
    return res.json({ ok: true, members: rows.filter(m => m.userId).map(m => ({
      uid: m.userId.uid, username: m.userId.username, displayName: m.userId.displayName,
      avatar: m.userId.avatar, accountStatus: m.userId.status, memberType: m.memberType,
      status: m.status, permissions: m.permissions, commissionRateBps: m.commissionRateBps,
      joinedAt: m.joinedAt
    })) });
  } catch (error) { return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر تحميل أعضاء الوكالة" }); }
});

router.post("/:agencyId/members", async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      if (!validObjectId(req.params.agencyId)) throw httpError(400, "معرّف الوكالة غير صحيح");
      const agency = await Agency.findById(req.params.agencyId).session(session);
      if (!agency) throw httpError(404, "الوكالة غير موجودة");
      if (agency.status !== "active") throw httpError(409, "لا يمكن إضافة أعضاء لوكالة غير نشطة");
      const actor = await activeActor(req.auth.sub, session);
      const isOwner = actor.role === "owner";
      if (!isOwner) {
        const manager = await AgencyMembership.exists({ agencyId: agency._id, userId: actor._id, memberType: "manager", status: "active" }).session(session);
        if (!manager) throw httpError(403, "إضافة الأعضاء متاحة لمالك التطبيق أو مدير الوكالة");
      }
      const uid = Number(req.body.uid);
      if (!Number.isSafeInteger(uid) || uid < 1) throw httpError(400, "رقم المستخدم غير صحيح");
      const target = await User.findOne({ uid, status: "active" }).session(session).select("_id uid role");
      if (!target) throw httpError(404, "المستخدم غير موجود أو موقوف");
      if (String(target._id) === String(agency.managerUserId)) throw httpError(409, "مدير الوكالة مسجل بالفعل");
      const memberType = agency.type === "host" ? "host" : "distributor";
      const rate = Number(req.body.commissionRateBps || 0);
      if (!Number.isInteger(rate) || rate < 0 || rate > 10000) throw httpError(400, "نسبة العمولة غير صحيحة");
      const existing = await AgencyMembership.findOne({ agencyId: agency._id, userId: target._id, memberType }).session(session);
      if (existing && existing.status === "active") throw httpError(409, "المستخدم عضو بالفعل في هذه الوكالة");
      if (existing) {
        existing.status = "active"; existing.invitedBy = actor._id;
        existing.joinedAt = new Date(); existing.removedAt = null; existing.removalReason = "";
        existing.commissionRateBps = rate;
        await existing.save({ session });
        result = existing;
      } else {
        [result] = await AgencyMembership.create([{
          agencyId: agency._id, userId: target._id, memberType,
          status: "active", invitedBy: actor._id, commissionRateBps: rate
        }], { session });
      }
      await audit(session, actor, "agency.member.added", "agency", agency._id, req.body.reason || "إضافة عضو", { uid, memberType });
    });
    return res.status(201).json({ ok: true, membershipId: String(result._id), repeated: false });
  } catch (error) {
    if (error && error.code === 11000) return res.status(409).json({ ok: false, message: "المستخدم مرتبط بالفعل بوكالة مضيفين نشطة" });
    return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر إضافة العضو" });
  } finally { await session.endSession(); }
});

router.post("/:agencyId/members/:uid/remove", async (req, res) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      if (!validObjectId(req.params.agencyId)) throw httpError(400, "معرّف الوكالة غير صحيح");
      const agency = await Agency.findById(req.params.agencyId).session(session);
      if (!agency) throw httpError(404, "الوكالة غير موجودة");
      const actor = await activeActor(req.auth.sub, session);
      const isOwner = actor.role === "owner";
      if (!isOwner) {
        const manager = await AgencyMembership.exists({ agencyId: agency._id, userId: actor._id, memberType: "manager", status: "active" }).session(session);
        if (!manager) throw httpError(403, "ليس لديك صلاحية إزالة الأعضاء");
      }
      const uid = Number(req.params.uid);
      const target = await User.findOne({ uid }).session(session).select("_id");
      if (!target) throw httpError(404, "المستخدم غير موجود");
      if (String(target._id) === String(agency.managerUserId)) throw httpError(403, "تغيير مدير الوكالة يتم من لوحة المالك");
      const member = await AgencyMembership.findOne({ agencyId: agency._id, userId: target._id, status: "active" }).session(session);
      if (!member) throw httpError(404, "العضوية النشطة غير موجودة");
      member.status = "removed"; member.removedAt = new Date();
      member.removalReason = String(req.body.reason || "").trim().slice(0, 240);
      await member.save({ session });
      await audit(session, actor, "agency.member.removed", "agency", agency._id, member.removalReason || "إزالة عضو", { uid, memberType: member.memberType });
    });
    return res.json({ ok: true });
  } catch (error) { return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر إزالة العضو" }); }
  finally { await session.endSession(); }
});

router.post("/:agencyId/charge", async (req, res) => {
  const uid = Number(req.body.uid);
  const packageId = String(req.body.packageId || "");
  let key;
  try { key = idempotencyKey(req); } catch (error) { return res.status(error.status).json({ ok: false, message: error.message }); }
  if (!Number.isSafeInteger(uid) || uid < 1 || !/^[A-Za-z0-9_-]{1,40}$/.test(packageId)) return res.status(400).json({ ok: false, message: "بيانات الشحن غير صحيحة" });
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      if (!validObjectId(req.params.agencyId)) throw httpError(400, "معرّف الوكالة غير صحيح");
      const actor = await activeActor(req.auth.sub, session);
      const agency = await Agency.findById(req.params.agencyId).session(session);
      if (!agency || agency.type !== "recharge") throw httpError(404, "وكالة الشحن غير موجودة");
      if (agency.status !== "active") throw httpError(409, "وكالة الشحن موقوفة");
      if (actor.role !== "owner") {
        const membership = await AgencyMembership.findOne({
          agencyId: agency._id, userId: actor._id, status: "active",
          memberType: { $in: ["manager", "distributor"] }
        }).session(session);
        if (!membership) throw httpError(403, "ليس لديك صلاحية الشحن من هذه الوكالة");
      }
      const pkg = agency.packages.find(p => p.packageId === packageId && p.active);
      if (!pkg) throw httpError(404, "باقة الشحن غير متاحة");
      const target = await User.findOne({ uid, status: "active" }).session(session).select("_id uid coins");
      if (!target) throw httpError(404, "المستخدم غير موجود أو موقوف");
      const existing = await AgencyLedger.findOne({ idempotencyKey: key }).session(session);
      if (existing) {
        if (String(existing.agencyId) !== String(agency._id) || String(existing.targetUserId) !== String(target._id) ||
            existing.type !== "user_charge" || existing.amountCoins !== pkg.coins) throw httpError(409, "معرّف العملية مستخدم لطلب شحن مختلف");
        const current = await User.findById(target._id).session(session).select("coins");
        result = { coins: current.coins, agencyBalanceCoins: agency.balanceCoins, transactionId: String(existing._id), repeated: true };
        return;
      }
      const before = agency.balanceCoins;
      const updatedAgency = await Agency.findOneAndUpdate(
        { _id: agency._id, status: "active", balanceCoins: { $gte: pkg.coins } },
        { $inc: { balanceCoins: -pkg.coins } },
        { new: true, session }
      );
      if (!updatedAgency) throw httpError(409, "رصيد وكالة الشحن غير كافٍ");
      const updatedUser = await User.findOneAndUpdate(
        { _id: target._id, status: "active" },
        { $inc: { coins: pkg.coins } },
        { new: true, session, projection: { coins: 1, uid: 1 } }
      );
      if (!updatedUser) throw httpError(409, "تعذر تحديث محفظة المستخدم");
      await Wallet.updateOne({ userId: target._id }, { $set: { balance: updatedUser.coins } }, { upsert: true, session });
      const [walletTx] = await WalletTransaction.create([{
        from: actor._id, to: target._id, amount: pkg.coins, type: "agency_charge",
        description: "شحن عبر وكالة " + agency.agencyCode, idempotencyKey: key
      }], { session });
      const commissionMinor = Math.floor(pkg.priceMinor * pkg.commissionRateBps / 10000);
      const [entry] = await AgencyLedger.create([{
        agencyId: agency._id, actorUserId: actor._id, targetUserId: target._id,
        type: "user_charge", direction: "debit", amountCoins: pkg.coins,
        balanceBefore: before, balanceAfter: updatedAgency.balanceCoins,
        amountMinor: pkg.priceMinor, currency: pkg.currency, commissionMinor,
        description: "شحن المستخدم ID " + uid + " عبر الباقة " + packageId,
        idempotencyKey: key, referenceId: String(walletTx._id)
      }], { session });
      result = { coins: updatedUser.coins, agencyBalanceCoins: updatedAgency.balanceCoins, transactionId: String(entry._id), walletTransactionId: String(walletTx._id), repeated: false };
    });
    const io = req.app.get("io");
    if (io && result) {
      const target = await User.findOne({ uid }).select("_id").lean();
      if (target) io.to("user:" + String(target._id)).emit("wallet:updated", { uid, coins: result.coins });
    }
    return res.json({ ok: true, ...result });
  } catch (error) {
    if (error && error.code === 11000) {
      const existing = await AgencyLedger.findOne({ idempotencyKey: key }).lean().catch(() => null);
      if (existing && String(existing.agencyId) === req.params.agencyId && existing.type === "user_charge") {
        const user = await User.findOne({ uid }).select("coins").lean();
        const agency = await Agency.findById(req.params.agencyId).select("balanceCoins").lean();
        return res.json({ ok: true, coins: user?.coins, agencyBalanceCoins: agency?.balanceCoins, transactionId: String(existing._id), repeated: true });
      }
      return res.status(409).json({ ok: false, message: "معرّف العملية مستخدم بالفعل" });
    }
    return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر تنفيذ شحن الوكالة" });
  } finally { await session.endSession(); }
});

router.get("/:agencyId/ledger", async (req, res) => {
  try {
    if (!validObjectId(req.params.agencyId)) return res.status(400).json({ ok: false, message: "معرّف الوكالة غير صحيح" });
    const agency = await Agency.findById(req.params.agencyId).lean();
    if (!agency) return res.status(404).json({ ok: false, message: "الوكالة غير موجودة" });
    await agencyAccess(req.auth.sub, agency);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
    const entries = await AgencyLedger.find({ agencyId: agency._id }).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({ ok: true, entries });
  } catch (error) { return res.status(error.status || 500).json({ ok: false, message: error.status ? error.message : "تعذر تحميل كشف الوكالة" }); }
});

module.exports = router;
