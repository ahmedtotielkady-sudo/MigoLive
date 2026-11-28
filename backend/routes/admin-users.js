const express = require("express");
const User = require("../models/User");
const bcrypt = require("bcryptjs");
const rateLimit = require("express-rate-limit");
const requireAuth = require("../middleware/requireAuth");
const AdminAuditLog = require("../models/AdminAuditLog");
async function audit(req, action, target, reason, metadata={}) { await AdminAuditLog.create({actorUserId:req.auth.sub,action,targetType:"user",targetId:String(target.uid),reason:String(reason||"").slice(0,500),metadata}); }

const router = express.Router();
router.use(requireAuth);

// Member administration is restricted to the verified primary owner role.
// Never trust a role value supplied by the browser or JWT alone.
router.use(async (req, res, next) => {
  try {
    const actor = await User.findById(req.auth.sub).select("role status").lean();
    if (!actor || actor.status !== "active" || actor.role !== "owner") {
      return res.status(403).json({ ok: false, message: "ليس لديك صلاحية إدارة الأعضاء" });
    }
    return next();
  } catch (error) {
    return next(error);
  }
});

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function memberView(user) {
  return {
    uid: user.uid,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar || "",
    phoneMasked: user.phone ? String(user.phone).replace(/(\+?\d{2,4})\d+(\d{2,3})$/, "$1••••••$2") : "",
    emailMasked: user.email ? String(user.email).replace(/^(.).+(@.*)$/, "$1••••$2") : "",
    role: user.role,
    status: user.status,
    coins: Number(user.coins) || 0,
    createdAt: user.createdAt || null,
    lastLoginAt: user.lastLoginAt || null
  };
}

// GET /api/admin/users?q=&status=all|active|banned&page=1&limit=30
router.get("/", async (req, res, next) => {
  try {
    const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
    const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 30));
    const status = ["active", "banned"].includes(String(req.query.status || ""))
      ? String(req.query.status) : "";
    const q = String(req.query.q || "").trim().slice(0, 80);
    const filter = {};
    if (status) filter.status = status;
    if (q) {
      const numericUid = /^\d{1,10}$/.test(q) ? Number(q) : null;
      const regex = new RegExp(escapeRegex(q), "i");
      filter.$or = [
        { username: regex },
        { displayName: regex },
        ...(numericUid !== null ? [{ uid: numericUid }] : [])
      ];
    }
    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select("uid username displayName avatar phone email role status coins createdAt lastLoginAt")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
    ]);
    return res.json({
      ok: true,
      users: users.map(memberView),
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    });
  } catch (error) { return next(error); }
});

// POST /api/admin/users/:uid/ban
router.post("/:uid/ban", async (req, res, next) => {
  try {
    const uid = Number(req.params.uid);
    if (!Number.isSafeInteger(uid) || uid < 1) {
      return res.status(400).json({ ok: false, message: "رقم العضو غير صحيح" });
    }
    const target = await User.findOne({ uid });
    if (!target) return res.status(404).json({ ok: false, message: "العضو غير موجود" });
    if (target.role === "owner") {
      return res.status(403).json({ ok: false, message: "لا يمكن حظر مالك التطبيق" });
    }
    const reason = String(req.body && req.body.reason || "").trim().slice(0, 240);
    target.status = "banned";
    target.activeSessionId = null;
    target.activeSessionExpiresAt = null;
    await target.save();
    await audit(req,"user.ban",target,reason);

    const io = req.app.get("io");
    if (io) {
      const room = "user:" + String(target._id);
      io.emit("owner:member-updated", { uid: target.uid, action: "banned", status: "banned" });
      io.to(room).emit("auth:revoked", { message: "تم إيقاف هذا الحساب" });
      io.in(room).disconnectSockets(true);
    }
    return res.json({ ok: true, user: memberView(target), reason });
  } catch (error) { return next(error); }
});

// POST /api/admin/users/:uid/unban
router.post("/:uid/unban", async (req, res, next) => {
  try {
    const uid = Number(req.params.uid);
    if (!Number.isSafeInteger(uid) || uid < 1) {
      return res.status(400).json({ ok: false, message: "رقم العضو غير صحيح" });
    }
    const target = await User.findOne({ uid });
    if (!target) return res.status(404).json({ ok: false, message: "العضو غير موجود" });
    target.status = "active";
    // A previously banned user must sign in again; never restore an old session.
    target.activeSessionId = null;
    target.activeSessionExpiresAt = null;
    await target.save();
    await audit(req,"user.unban",target,"رفع الحظر");
    const io = req.app.get("io");
    if (io) io.emit("owner:member-updated", { uid: target.uid, action: "unbanned", status: "active" });
    return res.json({ ok: true, user: memberView(target) });
  } catch (error) { return next(error); }
});

// PATCH /api/admin/users/:uid — owner can correct a display name or change user/admin role.
router.patch("/:uid", async (req, res, next) => {
  try {
    const uid = Number(req.params.uid);
    if (!Number.isSafeInteger(uid) || uid < 1) {
      return res.status(400).json({ ok: false, message: "رقم العضو غير صحيح" });
    }
    const target = await User.findOne({ uid });
    if (!target) return res.status(404).json({ ok: false, message: "العضو غير موجود" });
    if (target.role === "owner") {
      return res.status(403).json({ ok: false, message: "لا يمكن تعديل صلاحيات مالك التطبيق" });
    }

    const updates = {};
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "displayName")) {
      const displayName = String(req.body.displayName || "").normalize("NFKC").trim();
      if (displayName.length < 2 || displayName.length > 40) {
        return res.status(400).json({ ok: false, message: "اسم العرض يجب أن يكون من حرفين إلى 40 حرفاً" });
      }
      updates.displayName = displayName;
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "role")) {
      const role = String(req.body.role || "");
      if (!["user", "admin"].includes(role)) {
        return res.status(400).json({ ok: false, message: "الصلاحية المطلوبة غير مسموحة" });
      }
      updates.role = role;
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ ok: false, message: "لا توجد تغييرات صالحة" });
    }
    Object.assign(target, updates);
    await target.save();
    await audit(req,"user.update",target,"تعديل بيانات أو صلاحية",updates);
    const io = req.app.get("io");
    if (io) io.to("user:" + String(target._id)).emit("owner:member-updated", { uid: target.uid, action: "profile-updated", user: memberView(target) });
    return res.json({ ok: true, user: memberView(target) });
  } catch (error) { return next(error); }
});

// POST /api/admin/users/:uid/logout — revoke the current device session immediately.
router.post("/:uid/logout", async (req, res, next) => {
  try {
    const uid = Number(req.params.uid);
    if (!Number.isSafeInteger(uid) || uid < 1) {
      return res.status(400).json({ ok: false, message: "رقم العضو غير صحيح" });
    }
    const target = await User.findOne({ uid });
    if (!target) return res.status(404).json({ ok: false, message: "العضو غير موجود" });
    if (target.role === "owner") {
      return res.status(403).json({ ok: false, message: "لا يمكن إنهاء جلسة مالك التطبيق" });
    }
    target.activeSessionId = null;
    target.activeSessionExpiresAt = null;
    await target.save();
    await audit(req,"user.logout",target,"إنهاء جلسة المستخدم");
    const io = req.app.get("io");
    if (io) {
      const room = "user:" + String(target._id);
      io.emit("owner:member-updated", { uid: target.uid, action: "logout" });
      io.to(room).emit("auth:session-replaced", { message: "تم إنهاء جلسة الحساب بواسطة الإدارة" });
      io.in(room).disconnectSockets(true);
    }
    return res.json({ ok: true, user: memberView(target) });
  } catch (error) { return next(error); }
});

// POST /api/admin/users/:uid/reset-password
// The owner can set a new password, but no endpoint ever returns the current
// password or password hash. Revoke all existing sessions after the reset.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "محاولات كثيرة لإعادة تعيين كلمات المرور، حاول بعد 15 دقيقة" }
});

router.post("/:uid/reset-password", passwordResetLimiter, async (req, res, next) => {
  try {
    const uid = Number(req.params.uid);
    if (!Number.isSafeInteger(uid) || uid < 1) {
      return res.status(400).json({ ok: false, message: "رقم العضو غير صحيح" });
    }
    const password = String(req.body && req.body.newPassword || "");
    if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({ ok: false, message: "كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل وألا تتجاوز 72 بايتًا" });
    }

    const target = await User.findOne({ uid });
    if (!target) return res.status(404).json({ ok: false, message: "العضو غير موجود" });
    if (target.role === "owner") {
      return res.status(403).json({ ok: false, message: "لا يمكن تغيير كلمة مرور مالك التطبيق من إدارة الأعضاء" });
    }

    // Hash the supplied new password; never log or return it or its hash.
    target.passwordHash = await bcrypt.hash(password, 12);
    target.activeSessionId = null;
    target.activeSessionExpiresAt = null;
    await target.save();
    await audit(req, "user.password_reset", target, "إعادة تعيين كلمة المرور بواسطة المالك");

    const io = req.app.get("io");
    if (io) {
      const room = "user:" + String(target._id);
      io.emit("owner:member-updated", { uid: target.uid, action: "password-reset" });
      io.to(room).emit("auth:session-replaced", { message: "تم تغيير كلمة مرور الحساب، سجّل الدخول مرة أخرى" });
      io.in(room).disconnectSockets(true);
    }
    return res.json({ ok: true, message: "تم تغيير كلمة المرور بنجاح، يجب على المستخدم تسجيل الدخول من جديد" });
  } catch (error) { return next(error); }
});

module.exports = router;
