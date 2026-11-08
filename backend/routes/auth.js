const router = require("express").Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const auth = require("../middleware/auth");

const DESIGNATED_OWNER_USERNAME = "mostafa11111";
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

async function promoteDesignatedOwner(user) {
  if (user.username !== DESIGNATED_OWNER_USERNAME || user.role === "owner") return;
  const existingOwner = await User.exists({ role: "owner" });
  if (!existingOwner) {
    user.role = "owner";
    await user.save();
  }
}

router.post("/register", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username) || password.length < 10 || password.length > 128) return res.status(400).json({ error: "Username or password does not meet requirements" });
    const passwordHash = await bcrypt.hash(password, 12);
    const isDesignatedOwner = username === DESIGNATED_OWNER_USERNAME && !(await User.exists({ role: "owner" }));
    const user = await User.create({ username, passwordHash, ...(isDesignatedOwner ? { role: "owner" } : {}) });
    await Wallet.create({ userId: user._id, balance: 0 });
    return res.status(201).json({ id: user._id, username: user.username, role: user.role });
  } catch (e) { if (e.code === 11000) return res.status(409).json({ error: "Username already exists" }); next(e); }
});

router.post("/login", loginLimit, async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const user = await User.findOne({ username }).select("+passwordHash username role status");
    if (!user || user.status !== "active" || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ error: "Invalid username or password" });
    await promoteDesignatedOwner(user);
    const token = jwt.sign({ sub: user._id.toString() }, process.env.JWT_SECRET, { expiresIn: "2h", issuer: "migolive-api", audience: "migolive-app" });
    return res.json({ token, expiresIn: 7200, user: { id: user._id, username: user.username, role: user.role } });
  } catch (e) { next(e); }
});

router.get("/me", auth, async (req, res) => res.json({ id: req.user._id, username: req.user.username, role: req.user.role }));
module.exports = router;
