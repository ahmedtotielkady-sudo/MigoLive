const router = require("express").Router();
const auth = require("../middleware/auth");

const GAMES = Object.freeze({
  ocean_storm: "عاصفة المحيط",
  slot777: "سلوت 777",
  animal_wheel: "عجلة الحيوانات"
});

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

router.get("/:gameId", auth, (req, res) => {
  const name = GAMES[req.params.gameId];
  if (!name) {
    return res.status(404).json({ error: "Game not found" });
  }
  res.json({
    id: req.params.gameId,
    name,
    wallet: "shared",
    settlement: "server_only"
  });
});

module.exports = router;
