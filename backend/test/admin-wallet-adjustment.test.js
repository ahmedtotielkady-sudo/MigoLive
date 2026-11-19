"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const wallet = fs.readFileSync(path.join(__dirname, "..", "routes", "wallet.js"), "utf8");
const ledger = fs.readFileSync(path.join(__dirname, "..", "models", "WalletTransaction.js"), "utf8");
const bridge = fs.readFileSync(path.join(__dirname, "..", "..", "api-bridge.js"), "utf8");

test("existing Coins page form submits username and signed amount to the server", () => {
  assert.match(bridge, /اسم المستخدم/);
  assert.match(bridge, /العدد/);
  assert.match(bridge, /\/wallet\/admin\/adjust/);
  assert.match(bridge, /Idempotency-Key/);
  assert.match(bridge, /ownerAdjustmentRetries/);
});

test("admin wallet adjustment requires owner/admin and resolves an active username", () => {
  const route = wallet.slice(wallet.indexOf('router.post("/admin/adjust"'));
  assert.match(route, /\["owner", "admin"\]/);
  assert.match(route, /User\.findOne\(\{ username, status: "active" \}\)/);
  assert.match(route, /idempotencyKey: key/);
});

test("credits and deductions atomically update canonical coins, wallet balance and ledger", () => {
  const route = wallet.slice(wallet.indexOf('router.post("/admin/adjust"'));
  assert.match(route, /await session\.withTransaction/);
  assert.match(route, /\$inc: \{ coins: signedAmount \}/);
  assert.match(route, /coins: \{ \$gte: amount \}/);
  assert.match(route, /Wallet\.updateOne/);
  assert.match(route, /WalletTransaction\.create/);
  assert.match(ledger, /"admin_deduction"/);
});

test("admin adjustment prevents zero values and unsafe amounts", () => {
  const route = wallet.slice(wallet.indexOf('router.post("/admin/adjust"'));
  assert.match(route, /signedAmount === 0/);
  assert.match(route, /Number\.isSafeInteger\(signedAmount\)/);
});
