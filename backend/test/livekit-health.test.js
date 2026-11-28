"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("health status exposes LiveKit readiness without exposing credentials", () => {
  const server = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  assert.match(server, /voice:\s*\{/);
  assert.match(server, /configured:\s*Boolean\(/);
  assert.match(server, /LIVEKIT_URL/);
  assert.match(server, /LIVEKIT_API_KEY/);
  assert.match(server, /LIVEKIT_API_SECRET/);
  assert.doesNotMatch(server, /LIVEKIT_API_SECRET\s*:\s*process\.env/);
});
