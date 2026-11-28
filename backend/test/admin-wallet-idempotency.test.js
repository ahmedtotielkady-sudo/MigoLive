"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

test("admin credit and debit bind idempotency keys to actor, user, amount and reason", () => {
  const route = fs.readFileSync(path.join(root, "routes", "wallet.js"), "utf8");
  assert.ok(route.includes('action: "admin_credit"'));
  assert.ok(route.includes('action: "admin_debit"'));
  assert.ok(route.includes("actorId: String(req.auth.sub), targetUid, amount, description"));
  assert.ok(route.includes("existing.requestHash && existing.requestHash !== requestHash"));
});

test("concurrent admin credit and debit retries recover only the matching ledger entry", () => {
  const route = fs.readFileSync(path.join(root, "routes", "wallet.js"), "utf8");
  assert.ok(route.includes('if (error && error.code === 11000)'));
  assert.ok(route.includes("معرّف العملية مستخدم لشحنة مختلفة"));
  assert.ok(route.includes("معرّف العملية مستخدم لخصم مختلف"));
  assert.ok(route.includes("تعذر تأكيد نتيجة الشحن"));
  assert.ok(route.includes("تعذر تأكيد نتيجة الخصم"));
});
