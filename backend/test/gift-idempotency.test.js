"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

test("gift ledger stores a request fingerprint alongside its unique idempotency key", () => {
  const schema = require("../models/WalletTransaction").schema;
  assert.ok(schema.path("idempotencyKey").options.unique);
  assert.ok(schema.path("requestHash"));
  assert.equal(schema.path("requestHash").options.maxlength, 64);
});

test("gift retries bind the key to sender, recipient, room, gift and server price", () => {
  const route = fs.readFileSync(path.join(root, "routes", "gifts.js"), "utf8");
  assert.match(route, /requestFingerprint\(\{ action: "gift", senderId: String\(req\.auth\.sub\), recipientUid, roomCode, giftId: gift && gift\.id, coins: gift && gift\.coins \}\)/);
  assert.match(route, /existing\.requestHash && existing\.requestHash !== requestHash/);
  assert.match(route, /description: gift\.name, idempotencyKey: key, requestHash/);
});

test("concurrent duplicate gift requests recover the committed transaction without a second credit", () => {
  const route = fs.readFileSync(path.join(root, "routes", "gifts.js"), "utf8");
  assert.match(route, /error && error\.code === 11000/);
  assert.match(route, /WalletTransaction\.findOne\(\{ idempotencyKey: key \}\)\.lean\(\)/);
  assert.match(route, /transactionId: String\(existing\._id\), repeated: true/);
  assert.match(route, /idempotencyKey: key, requestHash/);
});
