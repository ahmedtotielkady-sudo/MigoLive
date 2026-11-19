"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const wallet = fs.readFileSync(path.join(__dirname, "..", "routes", "wallet.js"), "utf8");
const ledger = fs.readFileSync(path.join(__dirname, "..", "models", "WalletTransaction.js"), "utf8");

test("production wallet exposes authenticated admin adjustment endpoint", () => {
  assert.match(wallet, /router\.use\(requireAuth\)/);
  assert.match(wallet, /router\.post\("\/admin\/adjust"/);
  assert.match(wallet, /\["owner", "admin"\]/);
  assert.match(wallet, /const targetUid = Number\(req\.body\.targetUid\)/);
  assert.match(wallet, /User\.findOne\(\{ uid: targetUid, status: "active" \}\)/);\n  assert.doesNotMatch(wallet, /User\.findOne\(\{ username, status: "active" \}\)/);
});

test("admin adjustment atomically updates user, wallet and transaction ledger", () => {
  assert.match(wallet, /await session\.withTransaction/);
  assert.match(wallet, /\$inc: \{ coins: signedAmount \}/);
  assert.match(wallet, /coins: \{ \$gte: amount \}/);
  assert.match(wallet, /Wallet\.updateOne/);
  assert.match(wallet, /WalletTransaction\.create/);
  assert.match(ledger, /"admin_deduction"/);
});

test("admin adjustment requires idempotency key and validates signed integer amount", () => {
  assert.match(wallet, /idempotency-key/);
  assert.match(wallet, /Number\.isSafeInteger\(signedAmount\)/);
  assert.match(wallet, /idempotencyKey: key/);
});
