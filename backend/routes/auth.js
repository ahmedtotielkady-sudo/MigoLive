const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const Counter = require("../models/Counter");
const requireAuth = require("../middleware/requireAuth");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { getCountries, getCountryCallingCode, parsePhoneNumberFromString } = require("libphonenumber-js/max");
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const router = express.Router();
const TOKEN_TTL = "7d";
// Signup bonus is granted only while creating a brand-new account.
// Login intentionally never changes the persisted User.coins value.
const INITIAL_SIGNUP_COINS = 100;
function normalizePhone(value, country) {
  let input = String(value || "")
    .replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, digit => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[\s\u00a0\u200e\u200f\u202a-\u202e()-]/g, "");
  if (!input) return "";
  if (input.startsWith("00")) input = "+" + input.slice(2);
  try {
    const parsed = input.startsWith("+")
      ? parsePhoneNumberFromString(input)
      : parsePhoneNumberFromString(input, String(country || "EG").toUpperCase());
    return parsed && parsed.isValid() ? parsed.number : null;
  } catch (_) {
    return null;
  }
}

router.get("/phone-countries", (_req, res) => {
  const names = new Intl.DisplayNames(["ar"], { type: "region" });
  const countries = getCountries().map(country => ({
    country,
    callingCode: "+" + getCountryCallingCode(country),
    name: names.of(country) || country
  })).sort((a, b) => a.name.localeCompare(b.name, "ar"));
  return res.json({ ok: true, countries });
});

function publicUser(user) {
  return {
    id: String(user._id),
    uid: user.uid,
    username: user.username,
    displayName: user.displayName,
    phone: user.phone || "",
    email: user.email || "",
    coins: user.coins,
    role: user.role,
    avatar: user.avatar || "",
    createdAt: user.createdAt
  };
}

function issueToken(user, sessionId) {
  return jwt.sign(
    { sub: String(user._id), uid: user.uid, sid: sessionId },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL, issuer: "migolive-api", audience: "migolive-app" }
  );
}

router.post("/register", async (req, res, next) => {
  let dbSession;
  try {
    const username = String(req.body.username || "").trim();
    const displayName = String(req.body.displayName || username).trim().slice(0, 40);
    const phone = normalizePhone(req.body.phone, req.body.phoneCountry);
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!/^[\p{L}\p{N}_.-]{3,24}$/u.test(username)) {
      return res.status(400).json({ ok: false, message: "اسم المستخدم يجب أن يكون من 3 إلى 24 حرفًا أو رقمًا" });
    }
    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ ok: false, message: "كلمة المرور يجب ألا تقل عن 8 أحرف" });
    }
    if (phone === null) {
      return res.status(400).json({ ok: false, message: "رقم الهاتف غير صحيح" });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ ok: false, message: "البريد الإلكتروني غير صحيح" });
    }
    if (!phone && !email) {
      return res.status(400).json({ ok: false, message: "أدخل رقم الهاتف أو البريد الإلكتروني" });
    }

    const normalized = username.toLowerCase();
    const duplicate = await User.findOne({
      $or: [{ username: normalized }, ...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])]
    }).lean();
    if (duplicate) {
      return res.status(409).json({ ok: false, message: "اسم المستخدم أو رقم الهاتف مستخدم بالفعل" });
    }

    // Hash before opening the transaction so CPU work does not hold MongoDB locks.
    const passwordHash = await bcrypt.hash(password, 12);
    const sessionId = crypto.randomUUID();
    const now = new Date();
    dbSession = await User.startSession();
    let createdUser;

    // The UID counter, user record, and canonical wallet are one atomic unit.
    // If any write fails, MongoDB rolls all three back; no account can be left
    // registered without its initial 100-coin wallet.
    await dbSession.withTransaction(async () => {
      const counter = await Counter.findOneAndUpdate(
        { _id: "userUid" },
        { $inc: { value: 1 } },
        { new: true, upsert: true, setDefaultsOnInsert: true, session: dbSession }
      );

      const [user] = await User.create([{
        activeSessionId: sessionId,
        activeSessionExpiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        uid: 100000 + counter.value,
        username: normalized,
        displayName,
        phone: phone || undefined,
        email: email || undefined,
        passwordHash,
        coins: INITIAL_SIGNUP_COINS,
        role: "user"
      }], { session: dbSession });

      await Wallet.create([{
        userId: user._id,
        balance: INITIAL_SIGNUP_COINS
      }], { session: dbSession });

      createdUser = user;
    });

    const token = issueToken(createdUser, sessionId);
    return res.status(201).json({ ok: true, token, user: publicUser(createdUser) });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ ok: false, message: "اسم المستخدم أو رقم الهاتف مستخدم بالفعل" });
    }
    return next(error);
  } finally {
    if (dbSession) await dbSession.endSession();
  }
});
router.post("/login", async (req, res, next) => {
  try {
    const identifier = String(req.body.identifier || "").trim();
    const password = String(req.body.password || "");
    if (!identifier || !password) {
      return res.status(400).json({ ok: false, message: "أدخل رقم ID أو الهاتف وكلمة المرور" });
    }
    const normalizedPhone = normalizePhone(identifier, req.body.phoneCountry) || identifier.replace(/[\\s()-]/g, "");
    const normalizedEmail = identifier.includes("@") ? identifier.toLowerCase() : "";
    const byUid = /^\d{5,10}$/.test(identifier) ? Number(identifier) : -1;
    const user = await User.findOne({
      $or: [
        ...(byUid > 0 ? [{ uid: byUid }] : []),
        { username: identifier.toLowerCase() },
        { phone: normalizedPhone },
        ...(normalizedEmail ? [{ email: normalizedEmail }] : [])
      ]
    }).select("+passwordHash");
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ ok: false, message: "بيانات الدخول غير صحيحة" });
    }
    if (user.status === "banned") {
      return res.status(403).json({ ok: false, message: "هذا الحساب موقوف، تواصل مع الدعم" });
    }
    // Rotate the active session atomically. A later login immediately invalidates
    // every token issued to the previous device, even if two logins race.
    const sessionId = crypto.randomUUID();
    const activeUser = await User.findOneAndUpdate(
      { _id: user._id, status: { $ne: "banned" } },
      { $set: {
        lastLoginAt: new Date(),
        activeSessionId: sessionId,
        activeSessionExpiresAt: new Date(Date.now() + SESSION_TTL_MS)
      } },
      { new: true }
    );
    if (!activeUser) return res.status(403).json({ ok: false, message: "هذا الحساب غير متاح" });

    const io = req.app.get("io");
    if (io) {
      const userRoom = "user:" + String(activeUser._id);
      io.to(userRoom).emit("auth:session-replaced", { message: "تم تسجيل الدخول من جهاز آخر" });
      io.in(userRoom).disconnectSockets(true);
    }
    return res.json({ ok: true, token: issueToken(activeUser, sessionId), user: publicUser(activeUser) });
  } catch (error) {
    return next(error);
  }
});


const OwnerClaim = require("../models/OwnerClaim");

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await User.updateOne(
      { _id: req.auth.sub, activeSessionId: req.auth.sid },
      { $set: { activeSessionId: null, activeSessionExpiresAt: null } }
    );
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

router.post("/session/heartbeat", requireAuth, async (req, res, next) => {
  try {
    const result = await User.updateOne(
      { _id: req.auth.sub, activeSessionId: req.auth.sid, activeSessionExpiresAt: { $gt: new Date() } },
      { $set: { activeSessionExpiresAt: new Date(Date.now() + SESSION_TTL_MS) } }
    );
    if (!result.matchedCount) return res.status(401).json({ ok: false, code: "SESSION_REPLACED", message: "تم تسجيل الدخول من جهاز آخر" });
    return res.json({ ok: true });
  } catch (error) { return next(error); }
});

function safeSecretEqual(candidate, configured) {
  const a = Buffer.from(String(candidate || ""), "utf8");
  const b = Buffer.from(String(configured || ""), "utf8");
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Owner activation is server-only. The phrase must exist only in Railway Variables.
router.post("/owner/claim", rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false }), requireAuth, async (req, res, next) => {
  try {
    const configuredPhrase = process.env.OWNER_CLAIM_SECRET;
    if (!configuredPhrase) {
      return res.status(503).json({ ok: false, message: "تفعيل المالك غير مُعدّ على الخادم" });
    }
    const candidate = String(req.body && req.body.phrase || "");
    if (!safeSecretEqual(candidate, configuredPhrase)) {
      return res.status(403).json({ ok: false, message: "عبارة التفعيل غير صحيحة" });
    }

    const user = await User.findById(req.auth.sub);
    if (!user || user.status === "banned") {
      return res.status(403).json({ ok: false, message: "الحساب غير مؤهل للتفعيل" });
    }

    await OwnerClaim.updateOne(
      { _id: "primary-owner" },
      { $setOnInsert: { claimed: false } },
      { upsert: true }
    );

    const claim = await OwnerClaim.findOneAndUpdate(
      { _id: "primary-owner", claimed: false },
      { $set: { claimed: true, ownerUserId: user._id, claimedAt: new Date() } },
      { new: true }
    );

    if (!claim) {
      const existing = await OwnerClaim.findById("primary-owner");
      if (existing && String(existing.ownerUserId) === String(user._id)) {
        user.role = "owner";
        await user.save();
        return res.json({ ok: true, user: publicUser(user), alreadyOwner: true });
      }
      return res.status(409).json({ ok: false, message: "تم تفعيل مالك التطبيق بالفعل" });
    }

    user.role = "owner";
    await user.save();
    return res.json({ ok: true, user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.auth.sub);
    if (!user) return res.status(404).json({ ok: false, message: "الحساب غير موجود" });
    return res.json({ ok: true, user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
