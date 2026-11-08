const router = require("express").Router();
const auth = require("../middleware/auth");
const { executeTransaction } = require("../services/walletService");

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

// Debit is a server-side wallet operation. A client-supplied game result or
// payout is deliberately not accepted here.
router.post("/:gameId/debit", auth, async (req, res) => {
  const { gameId } = req.params;
  const { amount } = req.body;

  if (!GAMES[gameId]) {
    return res.status(404).json({ error: "Game not found" });
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: "Invalid bet amount" });
  }

  const suppliedKey = req.get("Idempotency-Key");
  if (typeof suppliedKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(suppliedKey)) {
    return res.status(400).json({ error: "A valid Idempotency-Key header is required" });
  }

  const reference = suppliedKey;

  try {
    const transaction = await executeTransaction({
      userId: req.user._id,
      amount,
      type: "game_debit",
      direction: "debit",
      reference,
      metadata: {
        game: gameId,
        gameName: GAMES[gameId],
        action: "bet"
      }
    });

    return res.status(200).json({
      success: true,
      game: gameId,
      amount,
      reference,
      duplicate: transaction.duplicate,
      transaction
    });
  } catch (error) {
    if (error.message === "Insufficient balance") {
      return res.status(409).json({ success: false, error: "Insufficient balance" });
    }
    if (error.message.includes("Idempotency key")) {
      return res.status(409).json({ success: false, error: "Idempotency key conflict" });
    }
    console.error("Game debit failed:", error);
    return res.status(500).json({ success: false, error: "Unable to process game debit" });
  }
});

module.exports = router;
