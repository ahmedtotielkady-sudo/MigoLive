"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "../..");

test("room presence is persisted in MongoDB with a TTL and unique socket identity", () => {
  const model = fs.readFileSync(path.join(root, "backend/models/RoomPresence.js"), "utf8");
  assert.match(model, /roomCode/);
  assert.match(model, /userId/);
  assert.match(model, /socketId/);
  assert.match(model, /expiresAt:\s*\{\s*type:\s*Date,\s*required:\s*true,\s*index:\s*\{\s*expires:\s*0/);
  assert.match(model, /unique:\s*true/);
});

test("realtime join and heartbeat maintain cross-instance presence snapshots", () => {
  const realtime = fs.readFileSync(path.join(root, "backend/realtime.js"), "utf8");
  assert.match(realtime, /RoomPresence\.findOneAndUpdate/);
  assert.match(realtime, /socket\.on\("room:heartbeat"/);
  assert.match(realtime, /expiresAt:\s*new Date\(Date\.now\(\) \+ 60_000\)/);
  assert.match(realtime, /online,\s*seats:/);
  assert.match(realtime, /RoomPresence\.deleteOne/);
  assert.match(realtime, /RoomPresence\.deleteMany/);
});

test("authenticated room presence endpoint returns active unique members only", () => {
  const route = fs.readFileSync(path.join(root, "backend/routes/room-details.js"), "utf8");
  assert.match(route, /router\.get\("\/:roomCode\/presence"/);
  assert.match(route, /expiresAt:\s*\{\s*\$gt:\s*new Date\(\)\s*\}/);
  assert.match(route, /userId:\s*\{\s*\$in:\s*room\.members\s*\}/);
  assert.match(route, /new Map\(\)/);
  assert.match(route, /"انضم إلى الغرفة أولاً"/);
});

test("Android room client polls the shared roster and renews its presence lease", () => {
  const bridge = fs.readFileSync(path.join(root, "voice-room.js"), "utf8");
  assert.match(bridge, /\/rooms\/" \+ session\.roomCode \+ "\/presence/);
  assert.match(bridge, /room:heartbeat/);
  assert.match(bridge, /setInterval\(\(\) => syncRoomPresence\(session\), 2_500\)/);
  assert.match(bridge, /stopPresenceSync\(session\)/);
  assert.match(bridge, /Array\.isArray\(joined\.online\)/);
});

test("room presence server and client scripts parse without syntax errors", () => {
  for (const file of [
    "backend/realtime.js",
    "backend/routes/rooms.js",
    "backend/routes/room-details.js",
    "backend/server.js",
    "voice-room.js"
  ]) {
    execFileSync(process.execPath, ["--check", path.join(root, file)]);
  }
});
