"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const Agency = require("../models/Agency");
const AgencyMembership = require("../models/AgencyMembership");
const AgencyLedger = require("../models/AgencyLedger");
const WalletTransaction = require("../models/WalletTransaction");

test("agency types and lifecycle are constrained in the database schema", () => {
  assert.deepEqual(Agency.schema.path("type").enumValues, ["host", "recharge"]);
  assert.deepEqual(Agency.schema.path("status").enumValues, ["pending", "active", "suspended", "closed"]);
  assert.ok(Agency.schema.path("agencyCode").options.unique);
});

test("a user can hold only one active host-agency membership", () => {
  const indexes = AgencyMembership.schema.indexes();
  assert.ok(indexes.some(([keys, options]) =>
    keys.userId === 1 && options.unique === true &&
    options.partialFilterExpression?.memberType === "host" &&
    options.partialFilterExpression?.status === "active"
  ));
  assert.ok(indexes.some(([keys, options]) =>
    keys.agencyId === 1 && keys.userId === 1 && keys.memberType === 1 && options.unique === true
  ));
});

test("agency ledger uses unique idempotency keys and immutable transaction fields", () => {
  assert.ok(AgencyLedger.schema.path("idempotencyKey").options.unique);
  for (const field of ["actorUserId", "agencyId", "amountCoins", "balanceBefore", "balanceAfter", "createdAt"]) {
    assert.ok(AgencyLedger.schema.path(field), "missing ledger field " + field);
  }
});

test("agency recharge is a supported canonical wallet transaction type", () => {
  assert.ok(WalletTransaction.schema.path("type").enumValues.includes("agency_charge"));
});

test("agency API enforces owner checks and server-side package pricing", () => {
  const route = fs.readFileSync(path.join(root, "routes", "agencies.js"), "utf8");
  assert.match(route, /requireOwner\(req\.auth\.sub/);
  assert.match(route, /packageId/);
  assert.match(route, /agency\.packages\.find\(p => p\.packageId === packageId && p\.active\)/);
  assert.match(route, /session\.withTransaction/);
  assert.match(route, /idempotency-key/);
  assert.match(route, /balanceCoins: \{ \$gte: pkg\.coins \}/);
  assert.match(route, /\$inc: \{ coins: pkg\.coins \}/);
});

test("server mounts agency APIs and initializes unique indexes before listening", () => {
  const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert.match(server, /app\.use\("\/api\/agencies".*routes\/agencies/);
  assert.match(server, /AgencyMembership\.init\(\)/);
  assert.match(server, /AgencyLedger\.init\(\)/);
});
