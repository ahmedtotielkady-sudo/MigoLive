const router = require("express").Router();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const Ledger = require("../models/Ledger");
const OwnerClaim = require("../models/OwnerClaim");
const auth = require("../middleware/auth");

const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false
});
const ownerClaimLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false
});

function issueToken(user) {
  const token = jwt.sign(
    { sub: user._id.toString() },
    process.env.JWT_SECRET,
    { expiresIn: "2h", issuer: "migolive-api", audience: "migolive-app", algorithm: "HS256" }
  );
  return {
    token,
    expiresIn: 7200,
    user: {
      id: user._id,
      username: user.username,
      displayName: user.displayName || user.username,
      legacyUid: user.legacyUid || null,
      role: user.role
    }
  };
}

router.post("/register", loginLimit, async (req, res, next) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const displayName = String(req.body.displayName || username).trim().slice(0, 48);
  const phone = String(req.body.phone || "").replace(/[\\s()-]/g, "");

  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username) || password.length < 10 || password.length > 128) {
    return res.status(400).json({
      error: "Username must be 3-24 letters, numbers or underscores; password must be 10-128 characters"
    });
  }
  if (phone && !/^\\+?\\d{7,15}$/.test(phone)) {
    return res.status(400).json({ error: "Invalid phone number" });
  }

  const session = await mongoose.startSession();
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    let user;
    await session.withTransaction(async () => {
      let legacyUid;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const candidate = String(1000000 + crypto.randomInt(0, 9000000));
        const exists = await User.findOne({ legacyUid: candidate }).session(session).select("_id");
        if (!exists) { legacyUid = candidate; break; }
      }
      if (!legacyUid) throw new Error("Unable to allocate account ID; retry registration");

      const created = await User.create([{
        username,
        legacyUid,
        displayName,
        phone: phone || undefined,
        passwordHash,
        role: "user",
        status: "active"
      }], { session });
      user = created[0];
      await Wallet.create([{ userId: user._id, balance: 100 }], { session });
      await Ledger.create([{
        userId: user._id,
        type: "welcome_bonus",
        amount: 100,
        direction: "credit",
        reference: "welcome:" + user._id.toString(),
        status: "posted",
        metadata: { action: "new_account_registration" }
      }], { session });
    });

    return res.status(201).json(issueToken(user));
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "Username or phone number already exists" });
    return next(error);
  } finally {
    await session.endSession();
  }
});

// One-time migration path for accounts held by the previous localStorage app.
// Only the password is used to authenticate; client-supplied coin balances and
// roles are deliberately ignored. The server creates the canonical wallet.
router.post("/legacy-login", loginLimit, async (req, res, next) => {
  const legacyUid = String(req.body.legacyUid || "");
  const password = String(req.body.password || "");
  const displayName = String(req.body.displayName || "").trim().slice(0, 48);
  const phone = String(req.body.phone || "").replace(/[\s()-]/g, "");

  if (!/^\d{5,10}$/.test(legacyUid) || password.length < 6 || password.length > 128) {
    return res.status(400).json({ error: "Invalid legacy account credentials" });
  }
  if (phone && !/^\+?\d{7,15}$/.test(phone)) {
    return res.status(400).json({ error: "Invalid phone number" });
  }

  try {
    let user = await User.findOne({ legacyUid }).select("+passwordHash username displayName legacyUid phone role status");
    if (!user && phone) {
      const byPhone = await User.findOne({ phone }).select("+passwordHash username displayName legacyUid phone role status");
      if (byPhone && byPhone.legacyUid !== legacyUid) {
        return res.status(409).json({ error: "Phone number is linked to another account" });
      }
      user = byPhone;
    }

    if (user) {
      if (user.status !== "active" || !(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(401).json({ error: "Invalid ID or password" });
      }
      if (phone && !user.phone) {
        user.phone = phone;
        await user.save();
      }
      return res.json(issueToken(user));
    }

    const session = await mongoose.startSession();
    try {
      const passwordHash = await bcrypt.hash(password, 12);
      await session.withTransaction(async () => {
        const created = await User.create([{
          username: "mg_" + legacyUid,
          legacyUid,
          phone: phone || undefined,
          displayName: displayName || ("عضو " + legacyUid),
          passwordHash,
          role: "user",
          status: "active"
        }], { session });
        user = created[0];
        // The old app granted 100 coins to every newly-created account.
        // Existing local balances are not trusted or imported from the client.
        await Wallet.create([{ userId: user._id, balance: 100 }], { session });
        await Ledger.create([{
          userId: user._id,
          type: "welcome_bonus",
          amount: 100,
          direction: "credit",
          reference: "legacy-welcome:" + legacyUid,
          status: "posted",
          metadata: { action: "legacy_account_migration" }
        }], { session });
      });
    } finally {
      await session.endSession();
    }
    return res.status(201).json(issueToken(user));
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: "Account migration conflict; retry login" });
    }
    return next(error);
  }
});

router.post("/login", loginLimit, async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    if (!username || password.length > 128) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    const user = await User.findOne({ username }).select("+passwordHash username displayName role status");
    if (!user || user.status !== "active" || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    return res.json(issueToken(user));
  } catch (error) {
    return next(error);
  }
});

// The bootstrap secret exists only in the server environment. The client
// submits it once over HTTPS; it is never compiled into index.html or an APK.
router.post("/claim-owner", auth, ownerClaimLimit, async (req, res, next) => {
  const configuredCode = process.env.OWNER_BOOTSTRAP_CODE;
  const suppliedCode = String(req.body.code || "");
  if (!configuredCode || configuredCode.length < 32) {
    return res.status(503).json({ error: "Owner bootstrap is not configured" });
  }
  if (!suppliedCode || suppliedCode.length > 256) {
    return res.status(401).json({ error: "Invalid owner activation code" });
  }

  const expected = Buffer.from(configuredCode);
  const supplied = Buffer.from(suppliedCode);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) {
    return res.status(401).json({ error: "Invalid owner activation code" });
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const claimed = await OwnerClaim.findById("primary").session(session);
      if (claimed) {
        if (String(claimed.userId) !== String(req.user._id)) {
          throw Object.assign(new Error("Primary owner already claimed"), { status: 409 });
        }
        return;
      }

      const existingOwners = await User.countDocuments({ role: "owner" }).session(session);
      if (existingOwners > 0) {
        throw Object.assign(new Error("An owner already exists; reconcile the owner record before bootstrap"), { status: 409 });
      }

      await OwnerClaim.create([{ _id: "primary", userId: req.user._id }], { session });
      const changed = await User.updateOne(
        { _id: req.user._id, role: { $in: ["user", "admin"] }, status: "active" },
        { $set: { role: "owner" } },
        { session }
      );
      if (!changed.modifiedCount) throw new Error("Unable to assign owner role");
    });

    const updatedUser = await User.findById(req.user._id).select("_id username displayName role status");
    return res.json({ success: true, user: updatedUser });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "Primary owner already claimed" });
    if (error.status) return res.status(error.status).json({ error: error.message });
    return next(error);
  } finally {
    await session.endSession();
  }
});


router.post("/profile", auth, async (req, res, next) => {
  const displayName = String(req.body.displayName || "").trim();
  if (displayName.length < 2 || displayName.length > 48) {
    return res.status(400).json({ error: "Display name must be 2-48 characters" });
  }
  try {
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { displayName } },
      { new: true, runValidators: true }
    ).select("_id username displayName legacyUid role");
    return res.json({ success: true, user });
  } catch (error) { return next(error); }
});

router.get("/me", auth, (req, res) => {
  return res.json({
    id: req.user._id,
    username: req.user.username,
    displayName: req.user.displayName || req.user.username,
    legacyUid: req.user.legacyUid || null,
    role: req.user.role
  });
});

module.exports = router;
