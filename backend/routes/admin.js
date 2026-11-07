const router = require("express").Router();
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const requireAdmin = require("../middleware/requireAdmin");
const User = require("../models/User");
const Wallet = require("../models/Wallet");
const Ledger = require("../models/Ledger");

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
      const allowed = ["topup", "topup_pending", "game_debit", "game_credit", "gift_debit", "gift_credit", "admin_adjustment"];
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

module.exports = router;
