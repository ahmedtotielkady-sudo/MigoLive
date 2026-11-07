
const router = require("express").Router();
const crypto = require("crypto");
const auth = require("../middleware/auth");
const { executeTransaction } = require("../services/walletService");

const GAMES = Object.freeze({
  ocean_storm: "عاصفة المحيط",
  slot777: "سلوت 777",
  animal_wheel: "عجلة الحيوانات"
});

// عرض الألعاب
router.get("/", auth, (req, res) => {
  res.json({
    games: Object.entries(GAMES).map(([id, name]) => ({
      id,
      name,
      wallet: "shared",
      settlement: "server_only"
    }))
  });
});

// تفاصيل اللعبة
router.get("/:gameId", auth, (req, res) => {
  const name = GAMES[req.params.gameId];

  if (!name) {
    return res.status(404).json({
      error: "Game not found"
    });
  }

  res.json({
    id: req.params.gameId,
    name,
    wallet: "shared",
    settlement: "server_only"
  });
});

// خصم رهان من المحفظة المشتركة
router.post("/:gameId/debit", auth, async (req, res) => {
  try {
    const { gameId } = req.params;
    const { amount } = req.body;

    if (!GAMES[gameId]) {
      return res.status(404).json({
        error: "Game not found"
      });
    }

    if (
      !Number.isSafeInteger(amount) ||
      amount <= 0
    ) {
      return res.status(400).json({
        error: "Invalid bet amount"
      });
    }

    const reference = crypto.randomUUID();

    const result = await executeTransaction({
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

    res.json({
      success: true,
      game: gameId,
      amount,
      reference,
      transaction: result
    });

  } catch (error) {
    res.status(400).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

