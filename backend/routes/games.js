const router = require("express").Router();
const auth = require("../middleware/auth");
const Ledger = require("../models/Ledger");

const GAMES = Object.freeze({
  ocean_storm: "عاصفة المحيط",
  slot777: "سلوت 777",
  animal_wheel: "عجلة الحيوانات"
});


// Authenticated game history is read from the immutable MongoDB ledger.
// The client never supplies balances or outcomes for these records.
router.get("/history", auth, async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 30);
  const game = req.query.game ? String(req.query.game) : "";
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ error: "Invalid pagination" });
  }
  if (game && !Object.prototype.hasOwnProperty.call(GAMES, game)) {
    return res.status(400).json({ error: "Invalid game" });
  }
  try {
    const filter = {
      userId: req.user._id,
      status: "posted",
      type: { $in: ["game_debit", "game_credit"] },
      ...(game ? { "metadata.game": game } : {})
    };
    const [items, total] = await Promise.all([
      Ledger.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("type amount direction reference metadata createdAt")
        .lean(),
      Ledger.countDocuments(filter)
    ]);
    return res.json({ page, limit, total, pages: Math.ceil(total / limit), items });
  } catch (error) {
    console.error("Game history failed:", error);
    return res.status(500).json({ error: "Unable to load game history" });
  }
});

// Per-user totals are derived from posted ledger entries, never browser state.
router.get("/stats", auth, async (req, res) => {
  try {
    const rows = await Ledger.aggregate([
      { $match: {
        userId: req.user._id,
        status: "posted",
        type: { $in: ["game_debit", "game_credit"] }
      } },
      { $group: {
        _id: "$metadata.game",
        bets: { $sum: { $cond: [{ $eq: ["$direction", "debit"] }, "$amount", 0] } },
        payouts: { $sum: { $cond: [{ $eq: ["$direction", "credit"] }, "$amount", 0] } },
        rounds: { $sum: { $cond: [{ $eq: ["$direction", "debit"] }, 1, 0] } }
      } },
      { $sort: { _id: 1 } }
    ]);
    return res.json({
      games: rows.map((row) => ({
        id: row._id,
        name: GAMES[row._id] || row._id,
        rounds: row.rounds,
        totalBet: row.bets,
        totalPayout: row.payouts,
        net: row.payouts - row.bets
      }))
    });
  } catch (error) {
    console.error("Game stats failed:", error);
    return res.status(500).json({ error: "Unable to load game statistics" });
  }
});

router.get("/", auth, (_req, res) => {
  res.json({
    games: Object.entries(GAMES).map(([id, name]) => ({
      id,
      name,
      wallet: "shared",
      settlement: "server_only"
    }))
  });
});

router.get("/:gameId", auth, (req, res) => {
  const name = GAMES[req.params.gameId];

  if (!name) return res.status(404).json({ error: "Game not found" });

  return res.json({
    id: req.params.gameId,
    name,
    wallet: "shared",
    settlement: "server_only"
  });
});

// The wheel result and payout are generated and settled entirely on the server.
// The client may submit stakes only; it cannot submit a winner or payout amount.
router.post("/animal_wheel/play", auth, async (req, res) => {
  const bets = req.body.bets;
  const reference = req.get("Idempotency-Key");
  if (!Array.isArray(bets) || bets.length !== 8 ||
      !bets.every((value) => Number.isSafeInteger(value) && value >= 0)) {
    return res.status(400).json({ error: "Eight non-negative integer bets are required" });
  }
  if (typeof reference !== "string" || !/^[A-Za-z0-9._:-]{8,100}$/.test(reference)) {
    return res.status(400).json({ error: "A valid Idempotency-Key header is required" });
  }

  try {
    const { executeAnimalWheelRound } = require("../services/animalWheelService");
    const result = await executeAnimalWheelRound({
      userId: req.user._id,
      bets,
      reference
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error.message === "Insufficient balance") {
      return res.status(409).json({ error: "Insufficient balance" });
    }
    if (error.message.includes("Idempotency key")) {
      return res.status(409).json({ error: "Idempotency key conflict" });
    }
    if (error.message.includes("Invalid") || error.message.includes("between 1")) {
      return res.status(400).json({ error: error.message });
    }
    console.error("Animal wheel round failed:", error);
    return res.status(500).json({ error: "Unable to settle animal wheel round" });
  }
});

router.get("/slot777/state", auth, async (req, res) => {
  try {
    const { getSlot777State } = require("../services/slot777Service");
    return res.json(await getSlot777State({ userId: req.user._id }));
  } catch (error) {
    console.error("Slot 777 state failed:", error);
    return res.status(500).json({ error: "Unable to load Slot 777 state" });
  }
});

// Slot 777 outcomes, free spins, and wallet settlement are generated on the server.
router.post("/slot777/spin", auth, async (req, res) => {
  const multiplierIndex = req.body.multiplierIndex;
  const reference = req.get("Idempotency-Key");
  if (!Number.isInteger(multiplierIndex) || multiplierIndex < 0 || multiplierIndex > 3) {
    return res.status(400).json({ error: "Invalid slot wager" });
  }
  if (typeof reference !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(reference)) {
    return res.status(400).json({ error: "A valid Idempotency-Key header is required" });
  }
  try {
    const { playSlot777 } = require("../services/slot777Service");
    return res.json(await playSlot777({ userId: req.user._id, multiplierIndex, reference }));
  } catch (error) {
    if (error.message === "Insufficient balance") return res.status(409).json({ error: "Insufficient balance" });
    if (error.message.includes("Idempotency key")) return res.status(409).json({ error: "Idempotency key conflict" });
    if (error.message.includes("Invalid")) return res.status(400).json({ error: error.message });
    console.error("Slot 777 round failed:", error);
    return res.status(500).json({ error: "Unable to settle Slot 777 round" });
  }
});

// Generic debit-only calls are intentionally disabled. A game must settle
// its complete server-authoritative round (debit, outcome, payout and ledger)
// atomically through its dedicated endpoint. This prevents orphaned coin loss.
router.post("/:gameId/debit", auth, (req, res) => {
  if (!GAMES[req.params.gameId]) {
    return res.status(404).json({ error: "Game not found" });
  }
  return res.status(410).json({
    success: false,
    error: "Debit-only game requests are disabled; use a server-settled game round"
  });
});

module.exports = router;
