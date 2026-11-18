"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..", "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("legacy migration endpoint is authenticated and rate limited", () => {
  const server = read("backend/server.js");
  const route = read("backend/routes/migration.js");
  assert.match(server, /app\.use\("\/api\/migration", rateLimit\([\s\S]*?require\("\.\/routes\/migration"\)\)/);
  assert.match(route, /router\.use\(requireAuth\)/);
  assert.match(route, /router\.post\("\/legacy"/);
  assert.match(route, /router\.get\("\/status"/);
});

test("legacy migration only accepts profile fields and ignores wallet and privilege claims", () => {
  const route = read("backend/routes/migration.js");
  assert.match(route, /new Set\(\["displayName", "avatar"\]\)/);
  for (const field of ["coins", "balance", "wallet", "role", "passwordHash", "activeSessionId"]) {
    assert.ok(route.includes('"' + field + '"'), "must explicitly reject " + field);
  }
  assert.match(route, /userId: req\.auth\.sub/);
  const model = read("backend/models/LegacyMigration.js");
  assert.match(model, /unique: true/);
  assert.match(model, /legacyMigrationSchema\.index\(\{ userId: 1, migrationId: 1 \}, \{ unique: true \}\)/);
  assert.match(route, /withTransaction/);
});

test("frontend submits only a matching authenticated legacy profile and does not cache password hashes", () => {
  const bridge = read("api-bridge.js");
  assert.match(bridge, /migrateLegacyProfile\(data\.user\)/);
  assert.match(bridge, /Number\(user\.uid\) === Number\(serverUser\.uid\)/);
  assert.match(bridge, /api\('\/migration\/legacy'/);
  assert.match(bridge, /delete DB\.users\[key\]\.pass/);
  assert.doesNotMatch(bridge, /pass:\s*password\s*\?\s*await hash/);
  assert.doesNotThrow(() => new vm.Script(bridge, { filename: "api-bridge.js" }));
});
