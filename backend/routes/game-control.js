"use strict";
const express = require("express");
const User = require("../models/User");
const AppGamePolicy = require("../models/AppGamePolicy");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

const GAMES = [
  { id: "slot-777", name: "سلوت 777" },
  { id: "ocean-storm", name: "عاصفة المحيط" },
  { id: "wheel-animals", name: "عجلة الحيوانات" },
  { id: "cleopatra-gold", name: "ذهب كليوباترا" },
  { id: "fruit-luck", name: "حظ الفواكه" },
  { id: "rocket-crash", name: "الصاروخ" },
  { id: "big-warrior", name: "المحارب الكبير" },
  { id: "pizza-yam", name: "بيتزا يم" },
  { id: "veggie", name: "خضار" }
];
async function ownerOnly(req, res, next) {
  try {
    const user = await User.findById(req.auth.sub).select("role status");
    if (!user || user.status !== "active" || user.role !== "owner")
      return res.status(403).json({ ok: false, message: "هذا الإجراء متاح لمالك التطبيق فقط" });
    req.owner = user; return next();
  } catch (error) { return next(error); }
}
router.get("/status", async (_req, res, next) => {
  try {
    const policy = await AppGamePolicy.findById("global").lean(), stored = policy && policy.games ? policy.games : {};
    return res.json({ ok: true, games: GAMES.map(game => {
      const value = stored instanceof Map ? stored.get(game.id) : stored[game.id];
      return { ...game, enabled: !(value && value.enabled === false) };
    }) });
  } catch (error) { return next(error); }
});
router.get("/policy", ownerOnly, async (_req, res, next) => {
  try {
    const policy = await AppGamePolicy.findById("global").lean(), stored = policy && policy.games ? policy.games : {};
    return res.json({ ok: true, games: GAMES.map(game => {
      const value = stored instanceof Map ? stored.get(game.id) : stored[game.id];
      return { ...game, enabled: !(value && value.enabled === false) };
    }) });
  } catch (error) { return next(error); }
});
router.put("/:gameId", ownerOnly, async (req, res, next) => {
  try {
    const game = GAMES.find(item => item.id === String(req.params.gameId));
    if (!game) return res.status(404).json({ ok: false, message: "اللعبة غير موجودة" });
    if (typeof req.body.enabled !== "boolean") return res.status(400).json({ ok: false, message: "حدد حالة تشغيل اللعبة" });
    const update = {
      ["games." + game.id + ".enabled"]: req.body.enabled,
      ["games." + game.id + ".updatedAt"]: new Date(),
      ["games." + game.id + ".updatedBy"]: req.auth.sub, updatedAt: new Date()
    };
    const policy = await AppGamePolicy.findOneAndUpdate(
      { _id: "global" }, { $set: update }, { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
    const value = policy.games instanceof Map ? policy.games.get(game.id) : policy.games[game.id];
    const updatedGame = { ...game, enabled: !(value && value.enabled === false) };
    const io = req.app.get("io");
    if (io) io.emit("owner:policy-updated", { kind: "game-control", game: updatedGame });
    return res.json({ ok: true, game: updatedGame });
  } catch (error) { return next(error); }
});
module.exports = router;
