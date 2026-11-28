"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

test("wallet transfer idempotency binds the key to the full transfer payload", () => {
  const route = fs.readFileSync(path.join(root, "routes", "wallet.js"), "utf8");
  assert.ok(route.includes('action: "wallet_transfer"'));
  assert.ok(route.includes("targetUid, amount, type, description"));
  assert.ok(route.includes("existing.requestHash && existing.requestHash !== requestHash"));
  assert.ok(route.includes("description, idempotencyKey: key, requestHash"));
});

test("concurrent wallet transfer retries recover the committed transaction", () => {
  const route = fs.readFileSync(path.join(root, "routes", "wallet.js"), "utf8");
  assert.ok(route.includes('if (error && error.code === 11000)'));
  assert.ok(route.includes('WalletTransaction.findOne({ idempotencyKey: key }).lean()'));
  assert.ok(route.includes("transactionId: String(existing._id), repeated: true"));
  assert.ok(route.includes("تعذر تأكيد نتيجة التحويل"));
});
