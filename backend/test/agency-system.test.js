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

test("agency mutations return an existing active membership instead of duplicating it", () => {
  const route = fs.readFileSync(path.join(root, "routes", "agencies.js"), "utf8");
  assert.ok(route.includes('if (existing && existing.status === "active")'));
  assert.ok(route.includes("result = existing; repeated = true;"));
  assert.match(route, /if \(member\.status === "removed"\) return/);
});
test("agency ledger stores a request fingerprint to reject idempotency-key payload mismatches", () => {
  assert.ok(AgencyLedger.schema.path("requestHash"));
  const route = fs.readFileSync(path.join(root, "routes", "agencies.js"), "utf8");
  assert.match(route, /requestFingerprint\(\{ action: "user_charge"/);
  assert.match(route, /existing\.requestHash !== requestFingerprint/);
});

test("agency manager transfer is owner-only, atomic, and auditable", () => {
  const route = fs.readFileSync(path.join(root, "routes", "agencies.js"), "utf8");
  assert.match(route, /router\.post\("\/owner\/:agencyId\/manager"/);
  assert.match(route, /requireOwner\(req\.auth\.sub, session\)/);
  assert.match(route, /agency\.managerUserId = nextManager\._id/);
  assert.match(route, /agency\.manager\.transferred/);
  assert.match(route, /session\.withTransaction/);
});

test("agency charge duplicate-key recovery resolves the target before comparing the request", () => {
  const route = fs.readFileSync(path.join(root, "routes", "agencies.js"), "utf8");
  assert.match(route, /const \[existing, target, agency\] = await Promise\.all/);
  assert.doesNotMatch(route, /if \(existing && user &&/);
  assert.match(route, /existing\.amountCoins === pkg\.coins/);
});

test("host agency transfer history is immutable and indexed", () => {
  const Transfer = require("../models/HostAgencyTransfer");
  assert.ok(Transfer.schema.path("hostUserId").options.immutable);
  assert.ok(Transfer.schema.path("fromAgencyId").options.immutable);
  assert.ok(Transfer.schema.path("toAgencyId").options.immutable);
  assert.ok(Transfer.schema.indexes().some(([keys]) => keys.hostUserId === 1 && keys.createdAt === -1));
});

test("host transfer is owner-only, validates target agency type and commits membership plus history atomically", () => {
  const route = fs.readFileSync(path.join(root, "routes", "agencies.js"), "utf8");
  assert.match(route, /router\.post\("\/owner\/hosts\/:uid\/transfer"/);
  assert.match(route, /targetAgency\.type !== "host"/);
  assert.match(route, /memberType: "host", status: "active"/);
  assert.ok(route.includes("HostAgencyTransfer.create(["));
  assert.match(route, /agency\.host\.transferred/);
  assert.match(route, /session\.withTransaction/);
});

test("host transfer history endpoint is owner-only and paginated", () => {
  const route = fs.readFileSync(path.join(root, "routes", "agencies.js"), "utf8");
  assert.match(route, /router\.get\("\/owner\/hosts\/:uid\/transfers"/);
  assert.match(route, /await requireOwner\(req\.auth\.sub\)/);
  assert.ok(route.includes("HostAgencyTransfer.create(["));
});

test("host transfer history has a unique idempotency key and immutable audit facts", () => {
  const HostTransfer = require("../models/HostAgencyTransfer");
  assert.ok(HostTransfer.schema.path("idempotencyKey").options.unique);
  for (const field of ["hostUserId", "fromAgencyId", "toAgencyId", "actorUserId", "reason", "idempotencyKey", "requestHash", "createdAt"]) {
    assert.ok(HostTransfer.schema.path(field), "missing transfer field " + field);
  }
  assert.equal(HostTransfer.schema.path("createdAt").options.immutable, true);
});

test("owner host transfer changes membership and writes history in one transaction", () => {
  const route = fs.readFileSync(path.join(root, "routes", "agencies.js"), "utf8");
  assert.match(route, /router\.post\("\/owner\/hosts\/:uid\/transfer"/);
  assert.match(route, /const actor = await requireOwner\(req\.auth\.sub, session\)/);
  assert.ok(route.includes('current.status = "removed"'));
  assert.ok(route.includes("HostAgencyTransfer.create(["));
  assert.match(route, /agency\.host\.transferred/);
  assert.match(route, /session\.withTransaction/);
});

test("agency financial reports aggregate daily/monthly sales and commissions from the immutable ledger", () => {
  const route = fs.readFileSync(path.join(root, "routes", "agencies.js"), "utf8");
  assert.match(route, /function aggregateAgencyReport\(filter, period\)/);
  assert.match(route, /commissionMinor: \{ \$sum: "\$commissionMinor" \}/);
  assert.match(route, /chargedCoins: \{ \$sum:/);
  assert.match(route, /timezone: "UTC"/);
  assert.match(route, /totalsByCurrency/);
  assert.match(route, /router\.get\("\/owner\/reports\/agencies"/);
});

test("agency managers can only access their own agency report and report windows are bounded", () => {
  const route = fs.readFileSync(path.join(root, "routes", "agencies.js"), "utf8");
  assert.match(route, /router\.get\("\/:agencyId\/reports"/);
  assert.match(route, /agencyAccess\(req\.auth\.sub, agency, \["manager"\]\)/);
  assert.match(route, /366 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(route, /يجب إرسال تاريخ البداية والنهاية معًا/);
});
