"use strict";

const GameRound = require("../models/GameRound");
const engine = require("../game-engines/rocket-crash");

function hasCrashed(round, now = Date.now()) {
  const startAt = new Date(round && round.outcome && round.outcome.startAt).getTime();
  const crashAt = Number(round && round.outcome && round.outcome.crashAtMultiplier);
  if (!Number.isFinite(startAt) || !Number.isFinite(crashAt) || crashAt < 1) return false;
  return engine.multiplierAt(startAt, now) >= crashAt;
}

/**
 * Finalize rocket losses independently of a connected game screen.
 * The wager was already debited at /start, so a crash only closes the round.
 * Conditional bulk updates make the worker safe across multiple API instances
 * and prevent it from overwriting a concurrent successful cashout/cancel.
 */
async function settleExpiredRocketRounds(now = Date.now(), model = GameRound) {
  const rounds = await model.find({
    gameId: "rocket-crash",
    status: "accepted",
    "outcome.startAt": { $lte: new Date(now) }
  }).select("_id outcome.startAt outcome.crashAtMultiplier").lean();

  const operations = [];
  for (const round of rounds) {
    if (!hasCrashed(round, now)) continue;
    operations.push({
      updateOne: {
        filter: { _id: round._id, gameId: "rocket-crash", status: "accepted" },
        update: { $set: {
          status: "lost",
          settledAt: new Date(now),
          "outcome.crashedAt": new Date(now)
        } }
      }
    });
  }
  if (!operations.length) return 0;
  const result = await model.bulkWrite(operations, { ordered: false });
  return Number(result.modifiedCount) || 0;
}

module.exports = { hasCrashed, settleExpiredRocketRounds };
