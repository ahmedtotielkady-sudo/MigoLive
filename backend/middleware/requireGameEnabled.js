"use strict";
const AppGamePolicy = require("../models/AppGamePolicy");
const User = require("../models/User");

const ROUTE_GAME = [
  [/^\/(?:slot-777)\//, "slot-777"],
  [/^\/(?:ocean-storm)\//, "ocean-storm"],
  [/^\/(?:wheel-animals)\//, "wheel-animals"],
  [/^\/(?:cleopatra-gold)\//, "cleopatra-gold"],
  [/^\/(?:fruit-luck)\//, "fruit-luck"],
  [/^\/(?:rocket-crash)\//, "rocket-crash"],
  [/^\/(?:big-warrior)\//, "big-warrior"]
];

module.exports = async function requireGameEnabled(req, res, next) {
  try {
    const match = ROUTE_GAME.find(([pattern]) => pattern.test(req.path));
    if (!match) return next();
    const user = await User.findById(req.auth.sub).select("role status").lean();
    if (!user || user.status !== "active") {
      return res.status(403).json({ ok: false, message: "الحساب غير نشط" });
    }
    // The owner can still enter a paused game for maintenance/testing.
    if (user.role === "owner") return next();
    const policy = await AppGamePolicy.findById("global").lean();
    const game = policy && policy.games && policy.games[match[1]];
    if (game && game.enabled === false) {
      return res.status(423).json({
        ok: false, code: "GAME_DISABLED", gameId: match[1],
        message: "هذه اللعبة متوقفة مؤقتًا من إدارة التطبيق"
      });
    }
    return next();
  } catch (error) { return next(error); }
};
