"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const route = fs.readFileSync(path.join(__dirname, "..", "routes", "app-update.js"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const model = fs.readFileSync(path.join(__dirname, "..", "models", "AppUpdatePolicy.js"), "utf8");

test("app update status is public and policy writes are owner-only", () => {
  assert.match(route, /router\.get\("\/status"/);
  assert.match(route, /router\.put\("\/policy", requireAuth, ownerOnly/);
  assert.match(route, /user\.role !== "owner"/);
});
test("mandatory update policy validates versions and HTTPS download URLs", () => {
  assert.match(route, /versionPattern\.test\(latestVersion\)/);
  assert.match(route, /versionPattern\.test\(minimumVersion\)/);
  assert.match(route, /\^https:/);
});
test("update policy is persisted and API route is mounted", () => {
  assert.match(model, /minimumVersion/);
  assert.match(model, /downloadUrl/);
  assert.match(route, /findOneAndUpdate/);
  assert.match(server, /\/api\/app-update/);
});
