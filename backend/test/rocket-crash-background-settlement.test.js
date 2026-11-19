"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { hasCrashed, settleExpiredRocketRounds } = require("../services/rocket-crash-settlement");

test("rocket loss can be detected from server time without an open game client", () => {
  const round = { outcome: { startAt: new Date(1000), crashAtMultiplier: 2 } };
  assert.equal(hasCrashed(round, 1000), false);
  assert.equal(hasCrashed(round, 1000 + Math.ceil(Math.log(2) / 0.13 * 1000)), true);
  assert.equal(hasCrashed({ outcome: { startAt: "invalid", crashAtMultiplier: 2 } }, 9000), false);
});

test("background worker only closes crashed accepted rounds and uses atomic status guards", async () => {
  const now = 20000;
  const rounds = [
    { _id: "lost-1", outcome: { startAt: new Date(1000), crashAtMultiplier: 1.5 } },
    { _id: "still-flying", outcome: { startAt: new Date(1000), crashAtMultiplier: 100 } },
    { _id: "lost-2", outcome: { startAt: new Date(1000), crashAtMultiplier: 1.1 } }
  ];
  let captured;
  const fakeModel = {
    find(filter) {
      assert.equal(filter.gameId, "rocket-crash");
      assert.equal(filter.status, "accepted");
      return { select() { return this; }, async lean() { return rounds; } };
    },
    async bulkWrite(operations, options) {
      captured = { operations, options };
      return { modifiedCount: 2 };
    }
  };
  assert.equal(await settleExpiredRocketRounds(now, fakeModel), 2);
  assert.equal(captured.operations.length, 2);
  assert.ok(captured.operations.every(op =>
    op.updateOne.filter.status === "accepted" &&
    op.updateOne.update.$set.status === "lost" &&
    op.updateOne.update.$set.settledAt instanceof Date
  ));
  assert.deepEqual(captured.options, { ordered: false });
});

test("worker does not issue an empty database write", async () => {
  const fakeModel = {
    find() { return { select() { return this; }, async lean() { return []; } }; },
    async bulkWrite() { throw new Error("must not write"); }
  };
  assert.equal(await settleExpiredRocketRounds(5000, fakeModel), 0);
});
