const router = require("express").Router();
const crypto = require("crypto");
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
  if (
    suppliedKey !== undefined &&
    (typeof suppliedKey !== "string" || !/^[A-Za-z0-9._:-]{8,128}$/.test(suppliedKey))
  ) {
    return res.status(400).json({ error: "Invalid idempotency key" });
  }

  const reference = suppliedKey || crypto.randomUUID();

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
