"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const route = fs.readFileSync(path.join(__dirname, "..", "routes", "admin-users.js"), "utf8");

test("password reset route is behind owner-only member administration middleware", () => {
  assert.match(route, /router\.use\(requireAuth\)/);
  assert.match(route, /actor\.role !== "owner"/);
  assert.match(route, /router\.post\("\/:uid\/reset-password"/);
});

test("password reset hashes new password and never returns password material", () => {
  assert.match(route, /bcrypt\.hash\(password, 12\)/);
  assert.match(route, /password\.length < 8 \|\| password\.length > 72/);
  assert.match(route, /user\.password_reset/);
  assert.doesNotMatch(route, /json\(\{[^}]*passwordHash/s);
  assert.doesNotMatch(route, /metadata:\s*\{[^}]*password/i);
});

test("password reset revokes active session and prevents owner target changes", () => {
  assert.match(route, /target\.role === "owner"/);
  assert.match(route, /activeSessionId = null/);
  assert.match(route, /activeSessionExpiresAt = null/);
  assert.match(route, /disconnectSockets\(true\)/);
});

test("password reset does not load the existing password hash", () => {
  assert.doesNotMatch(route, /select\(["']\+passwordHash["']\)/);
});
