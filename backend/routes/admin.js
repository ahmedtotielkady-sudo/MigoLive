const router = require("express").Router();
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const Ledger = require("../models/Ledger");
const requireOwner = require("../middleware/requireOwner");
const { reviewTopup } = require("../services/topupService");
const { executeTransaction } = require("../services/walletService");

router.use(auth, requireAdmin);

function parseDate(value, field) {
  if (value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(`Invalid ${field} date`);
    error.status = 400;
    throw error;
  }
  return date;
}

function dateFilter(query) {
  const from = parseDate(query.from, "from");
  const to = parseDate(query.to, "to");
  if (from && to && from > to) {
    const error = new Error("from must be earlier than or equal to to");
    error.status = 400;
    throw error;
  }
  if (!from && !to) return {};
  const createdAt = {};
  if (from) createdAt.$gte = from;
  if (to) createdAt.$lte = to;
  return { createdAt };
}

// Admin overview: aggregate balances and posted ledger activity without
// exposing password hashes, tokens, or private account fields.
router.get("/overview", async (_req, res, next) => {
  try {
    const [users, balances, transactions, gameActivity, recent] = await Promise.all([
      User.countDocuments(),
      Wallet.aggregate([{ $group: { _id: null, total: { $sum: "$balance" } } }]),
      Ledger.aggregate([
        { $match: { status: "posted" } },
        { $group: {
          _id: { type: "$type", direction: "$direction" },
          count: { $sum: 1 },
          amount: { $sum: "$amount" }
        } }
      ]),
      Ledger.aggregate([
        { $match: { status: "posted", type: { $in: ["game_debit", "game_credit"] } } },
        { $group: {
          _id: "$metadata.game",
          entries: { $sum: 1 },
          debited: { $sum: { $cond: [{ $eq: ["$direction", "debit"] }, "$amount", 0] } },
          credited: { $sum: { $cond: [{ $eq: ["$direction", "credit"] }, "$amount", 0] } }
        } },
        { $sort: { entries: -1 } }
      ]),
      Ledger.find({ status: "posted" })
        .sort({ createdAt: -1 })
        .limit(20)
        .select("userId type amount direction reference metadata createdAt")
        .populate("userId", "username")
        .lean()
    ]);

    return res.json({
      users,
      totalWalletCoins: balances[0]?.total || 0,
      transactionTotals: transactions,
      games: gameActivity,
      recentTransactions: recent
    });
  } catch (error) { return next(error); }
});


router.get("/users", async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 50);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: "Invalid pagination" });
    }

    const filter = {};
    if (req.query.q !== undefined) {
      const q = String(req.query.q).trim();
      if (q.length > 24) return res.status(400).json({ error: "Search query is too long" });
      if (q) {
        const escaped = q.split("").map((ch) => "\\^$.*+?()[]{}|".includes(ch) ? "\\" + ch : ch).join("");
        filter.$or = [
          { username: { $regex: escaped, $options: "i" } },
          ...( /^\d{5,10}$/.test(q) ? [{ legacyUid: q }] : [])
        ];
      }
    }
    if (req.query.status && ["active", "suspended"].includes(req.query.status)) {
      filter.status = req.query.status;
    } else if (req.query.status) {
      return res.status(400).json({ error: "Invalid user status" });
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("_id username legacyUid role status createdAt lastSeen")
        .lean(),
      User.countDocuments(filter)
    ]);

    const ids = users.map((user) => user._id);
    const wallets = await Wallet.find({ userId: { $in: ids } })
      .select("userId balance updatedAt")
      .lean();
    const balanceByUser = new Map(wallets.map((wallet) => [String(wallet.userId), wallet.balance]));

    return res.json({
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      users: users.map((user) => ({
        ...user,
        balance: balanceByUser.get(String(user._id)) || 0
      }))
    });
  } catch (error) { return next(error); }
});

// Paginated transaction audit with optional date, game and type filters.
router.get("/transactions", async (req, res, next) => {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 50);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: "Invalid pagination" });
    }

    const filter = { status: "posted", ...dateFilter(req.query) };
    if (req.query.type) {
      const allowed = ["topup", "topup_pending", "game_debit", "game_credit", "gift_debit", "gift_credit", "admin_adjustment", "welcome_bonus"];
      if (!allowed.includes(req.query.type)) return res.status(400).json({ error: "Invalid transaction type" });
      filter.type = req.query.type;
    }
    if (req.query.game) {
      if (!["ocean_storm", "slot777", "animal_wheel"].includes(req.query.game)) {
        return res.status(400).json({ error: "Invalid game" });
      }
      filter["metadata.game"] = req.query.game;
    }

    const [items, total] = await Promise.all([
      Ledger.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("userId type amount direction reference metadata createdAt")
        .populate("userId", "username")
        .lean(),
      Ledger.countDocuments(filter)
    ]);

    return res.json({ page, limit, total, pages: Math.ceil(total / limit), items });
  } catch (error) { return next(error); }
});

// Read-only user activity. No password or authentication fields are returned.
router.get("/users/:userId/activity", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.userId)) {
      return res.status(400).json({ error: "Invalid user id" });
    }
    const user = await User.findById(req.params.userId).select("_id username role status createdAt").lean();
    if (!user) return res.status(404).json({ error: "User not found" });

    const [wallet, transactions] = await Promise.all([
      Wallet.findOne({ userId: user._id }).select("balance updatedAt").lean(),
      Ledger.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .limit(100)
        .select("type amount direction reference status metadata createdAt")
        .lean()
    ]);

    return res.json({ user, balance: wallet?.balance || 0, transactions });
  } catch (error) { return next(error); }
});


// Pending top-ups are only credited after a human verifies the payment.
router.get("/topups/pending", async (_req, res, next) => {
  try {
    const items = await Ledger.find({ type: "topup_pending", status: "pending" })
      .sort({ createdAt: 1 })
      .limit(100)
      .select("userId amount reference metadata createdAt")
      .populate("userId", "username legacyUid")
      .lean();
    return res.json({ items });
  } catch (error) { return next(error); }
});

router.post("/topups/:reference/approve", async (req, res) => {
  try {
    const result = await reviewTopup({
      reference: req.params.reference,
      reviewerId: req.user._id,
      approve: true,
      note: req.body.note
    });
    return res.json(result);
  } catch (error) {
    if (error.message === "Pending top-up not found") return res.status(404).json({ error: error.message });
    console.error("Top-up approval failed:", error);
    return res.status(500).json({ error: "Unable to approve top-up" });
  }
});

router.post("/topups/:reference/reject", async (req, res) => {
  try {
    const result = await reviewTopup({
      reference: req.params.reference,
      reviewerId: req.user._id,
      approve: false,
      note: req.body.note
    });
    return res.json(result);
  } catch (error) {
    if (error.message === "Pending top-up not found") return res.status(404).json({ error: error.message });
    console.error("Top-up rejection failed:", error);
    return res.status(500).json({ error: "Unable to reject top-up" });
  }
});

// Only the primary owner may make manual balance adjustments. Every change is
// posted to the immutable transaction ledger and requires an idempotency key.
router.post("/wallet/adjust", requireOwner, async (req, res) => {
  const { userId, amount, direction, reason } = req.body;
  const targetFilter = mongoose.isValidObjectId(userId)
    ? { _id: userId, status: "active" }
    : (/^\d{5,10}$/.test(String(userId || "")) ? { legacyUid: String(userId), status: "active" } : null);
  if (!targetFilter) return res.status(400).json({ error: "Invalid user id" });
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
    return res.status(400).json({ error: "Invalid adjustment amount" });
  }
  if (!["credit", "debit"].includes(direction)) return res.status(400).json({ error: "Invalid direction" });
  const cleanReason = String(reason || "").trim().slice(0, 300);
  if (!cleanReason) return res.status(400).json({ error: "A reason is required" });
  const reference = req.get("Idempotency-Key");
  if (typeof reference !== "string" || !/^[A-Za-z0-9._:-]{8,100}$/.test(reference)) {
    return res.status(400).json({ error: "A valid Idempotency-Key header is required" });
  }
  try {
    const target = await User.findOne(targetFilter).select("_id");
    if (!target) return res.status(404).json({ error: "User not found" });
    const result = await executeTransaction({
      userId: target._id,
      amount,
      type: "admin_adjustment",
      direction,
      reference,
      metadata: { actorId: String(req.user._id), reason: cleanReason, action: "owner_adjustment" }
    });
    return res.json(result);
  } catch (error) {
    if (error.message === "Insufficient balance") return res.status(409).json({ error: "Insufficient balance" });
    if (error.message.includes("Idempotency key")) return res.status(409).json({ error: "Idempotency key conflict" });
    console.error("Owner wallet adjustment failed:", error);
    return res.status(500).json({ error: "Unable to adjust wallet" });
  }
});

module.exports = router;
