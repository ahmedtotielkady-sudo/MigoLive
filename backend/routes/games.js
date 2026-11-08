const router = require("express").Router();
const auth = require("../middleware/auth");
const { executeTransaction } = require("../services/walletService");

const GAMES = Object.freeze({
  ocean_storm: "عاصفة المحيط",
  slot777: "سلوت 777",
  animal_wheel: "عجلة الحيوانات"
});

router.use(auth);

// عرض الألعاب
router.get("/", (req, res) => {
  res.json({
    games: Object.entries(GAMES).map(([id, name]) => ({
      id, name, wallet: "shared", settlement: "server_only"
    }))
  });
});

// تفاصيل اللعبة
router.get("/:gameId", (req, res) => {
  const name = GAMES[req.params.gameId];
  if (!name) return res.status(404).json({ error: "Game not found" });
  res.json({ id: req.params.gameId, name, wallet: "shared", settlement: "server_only" });
});

// خصم الرهان مع مفتاح منع تكرار الطلب عند إعادة المحاولة.
router.post("/:gameId/debit", async (req, res, next) => {
  try {
    const { gameId } = req.params;
    const { amount } = req.body || {};

    if (!GAMES[gameId]) return res.status(404).json({ error: "Game not found" });
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid bet amount" });
    }

    const idempotencyKey = String(req.get("Idempotency-Key") || "").trim();
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(idempotencyKey)) {
      return res.status(400).json({
        error: "A valid Idempotency-Key header (8–100 characters) is required"
      });
    }

    const reference = `game:${req.user._id}:${gameId}:${idempotencyKey}`;
    const result = await executeTransaction({
      userId: req.user._id,
      amount,
      type: "game_debit",
      direction: "debit",
      reference,
      metadata: { game: gameId, gameName: GAMES[gameId], action: "bet" }
    });

    return res.json({
      success: true,
      duplicate: !!result.duplicate,
      game: gameId,
      amount,
      reference,
      transaction: result
    });
  } catch (error) {
    if (error.message === "Insufficient balance") {
      return res.status(409).json({ success: false, error: "Insufficient balance" });
    }
    return next(error);
  }
});

module.exports = router;
