const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");
const Counter = require("../models/Counter");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
const TOKEN_TTL = "7d";

function publicUser(user) {
  return {
    id: String(user._id),
    uid: user.uid,
    username: user.username,
    displayName: user.displayName,
    phone: user.phone || "",
    coins: user.coins,
    role: user.role,
    avatar: user.avatar || "",
    createdAt: user.createdAt
  };
}

function issueToken(user) {
  return jwt.sign(
    { sub: String(user._id), uid: user.uid },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL, issuer: "migolive-api", audience: "migolive-app" }
  );
}

router.post("/register", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const displayName = String(req.body.displayName || username).trim().slice(0, 40);
    const phone = String(req.body.phone || "").replace(/[\s()-]/g, "");
    const password = String(req.body.password || "");

    if (!/^[\p{L}\p{N}_.-]{3,24}$/u.test(username)) {
      return res.status(400).json({ ok: false, message: "اسم المستخدم يجب أن يكون من 3 إلى 24 حرفًا أو رقمًا" });
    }
    if (password.length < 8 || password.length > 72) {
      return res.status(400).json({ ok: false, message: "كلمة المرور يجب ألا تقل عن 8 أحرف" });
    }
    if (phone && !/^\+?[0-9]{7,15}$/.test(phone)) {
      return res.status(400).json({ ok: false, message: "رقم الهاتف غير صحيح" });
    }

    const normalized = username.toLowerCase();
    const duplicate = await User.findOne({
      $or: [{ username: normalized }, ...(phone ? [{ phone }] : [])]
    }).lean();
    if (duplicate) {
      return res.status(409).json({ ok: false, message: "اسم المستخدم أو رقم الهاتف مستخدم بالفعل" });
    }

    const counter = await Counter.findOneAndUpdate(
      { _id: "userUid" },
      { $inc: { value: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      uid: 100000 + counter.value,
      username: normalized,
      displayName,
      phone,
      passwordHash,
      coins: 100,
      role: "user"
    });
    const token = issueToken(user);
    return res.status(201).json({ ok: true, token, user: publicUser(user) });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(409).json({ ok: false, message: "اسم المستخدم أو رقم الهاتف مستخدم بالفعل" });
    }
    return next(error);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const identifier = String(req.body.identifier || "").trim();
    const password = String(req.body.password || "");
    if (!identifier || !password) {
      return res.status(400).json({ ok: false, message: "أدخل رقم ID أو الهاتف وكلمة المرور" });
    }
    const normalizedPhone = identifier.replace(/[\s()-]/g, "");
    const byUid = /^\d{5,10}$/.test(identifier) ? Number(identifier) : -1;
    const user = await User.findOne({
      $or: [
        ...(byUid > 0 ? [{ uid: byUid }] : []),
        { username: identifier.toLowerCase() },
        { phone: normalizedPhone }
      ]
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ ok: false, message: "بيانات الدخول غير صحيحة" });
    }
    if (user.status === "banned") {
      return res.status(403).json({ ok: false, message: "هذا الحساب موقوف، تواصل مع الدعم" });
    }
    user.lastLoginAt = new Date();
    await user.save();
    return res.json({ ok: true, token: issueToken(user), user: publicUser(user) });
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
