const router = require("express").Router();
const auth = require("../middleware/auth");

const GAMES = Object.freeze({
  ocean_storm: "عاصفة المحيط",
  slot777: "سلوت 777",
  animal_wheel: "عجلة الحيوانات"
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
