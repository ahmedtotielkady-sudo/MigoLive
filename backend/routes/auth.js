const router = require("express").Router();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
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

  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username) || password.length < 10 || password.length > 128) {
    return res.status(400).json({
      error: "Username must be 3-24 letters, numbers or underscores; password must be 10-128 characters"
    });
  }

  const session = await mongoose.startSession();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    let user;

    await session.withTransaction(async () => {
      const created = await User.create([{ username, passwordHash }], { session });
      user = created[0];
      await Wallet.create([{ userId: user._id, balance: 0 }], { session });
    });

    return res.status(201).json({ id: user._id, username: user.username });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: "Username already exists" });
    }
    return next(error);
  } finally {
    await session.endSession();
  }
});

router.post("/login", loginLimit, async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || password.length > 128) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const user = await User.findOne({ username })
      .select("+passwordHash username role status");

    if (!user || user.status !== "active" || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const token = jwt.sign(
      { sub: user._id.toString() },
      process.env.JWT_SECRET,
      {
        expiresIn: "2h",
        issuer: "migolive-api",
        audience: "migolive-app",
        algorithm: "HS256"
      }
    );

    return res.json({
      token,
      expiresIn: 7200,
      user: { id: user._id, username: user.username, role: user.role }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/me", auth, (req, res) => {
  return res.json({
    id: req.user._id,
    username: req.user.username,
    role: req.user.role
  });
});

module.exports = router;
