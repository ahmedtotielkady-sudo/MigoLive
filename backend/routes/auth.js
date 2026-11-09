const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const auth = require("../middleware/auth");

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});

router.post("/register", async (req, res, next) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const phone = String(req.body.phone || "").replace(/[\\s()-]/g, "");

  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username) || password.length < 6 || password.length > 128 ||
      (phone && !/^\\+?[0-9]{7,15}$/.test(phone))) {
    return res.status(400).json({ error: "Username or password does not meet requirements" });
  }

  const session = await mongoose.startSession();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    let user;

    // Create the account and its wallet atomically; never leave a user without a wallet.
    await session.withTransaction(async () => {
      const [created] = await User.create([{ username, phone: phone || undefined, passwordHash }], { session });
      await Wallet.create([{ userId: created._id, balance: 0 }], { session });
      user = created;
    });

    const token = jwt.sign(
      { sub: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: "2h", issuer: "migolive-api", audience: "migolive-app" }
    );

    return res.status(201).json({
      token,
      expiresIn: 7200,
      user: { id: user._id, username: user.username, role: user.role }
    });
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "Username already exists" });
    return next(e);
  } finally {
    await session.endSession();
  }
});

router.post("/login", loginLimit, async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const phone = String(req.body.phone || "").replace(/[\\s()-]/g, "");
    const password = String(req.body.password || "");
    const identity = phone
      ? { $or: [{ username }, { phone }] }
      : { username };
    const user = await User.findOne(identity).select("+passwordHash username phone role status");

    if (!user || user.status !== "active" || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign(
      { sub: user._id.toString() },
      process.env.JWT_SECRET,
      { expiresIn: "2h", issuer: "migolive-api", audience: "migolive-app" }
    );

    return res.json({
      token,
      expiresIn: 7200,
      user: { id: user._id, username: user.username, role: user.role }
    });
  } catch (e) {
    return next(e);
  }
});

router.get("/me", auth, async (req, res) => {
  res.json({ id: req.user._id, username: req.user.username, role: req.user.role });
});

module.exports = router;
