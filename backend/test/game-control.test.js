"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("owner game-control API exposes the seven games and rejects non-owner writes", () => {
  const source = read("routes/game-control.js");
  for (const id of ["slot-777","ocean-storm","wheel-animals","cleopatra-gold","fruit-luck","rocket-crash","big-warrior"]) {
    assert.ok(source.includes('"'+id+'"'), "missing "+id);
  }
  assert.match(source, /router\.get\("\/status"/);
  assert.match(source, /router\.get\("\/policy", ownerOnly/);
  assert.match(source, /router\.put\("\/:gameId", ownerOnly/);
  assert.match(source, /user\.role !== "owner"/);
});

test("every game action route enforces the central availability policy", () => {
  const files = ["routes/games.js","routes/ocean-storm.js","routes/cleopatra-gold.js","routes/big-warrior.js","routes/wheel-fruit.js","routes/rocket-crash.js"];
  for (const file of files) assert.match(read(file), /router\.use\(requireGameEnabled\)/, file);
  const middleware = read("middleware/requireGameEnabled.js");
  assert.match(middleware, /GAME_DISABLED/);
  assert.match(middleware, /game\.enabled === false/);
  assert.match(middleware, /user\.role === "owner"/);
});

test("public game catalog omits disabled games and app owner controls are wired", () => {
  const catalog = read("routes/games.js");
  const client = fs.readFileSync(path.join(__dirname, "..", "..", "api-bridge.js"), "utf8");
  assert.match(catalog, /AppGamePolicy\.findById/);
  assert.match(catalog, /game\.enabled === false/);
  assert.match(client, /openOwnerGameControlPanel/);
  assert.match(client, /game-control\/policy/);
  assert.match(client, /game-control\//);
  assert.match(client, /migo-game-picker \.migo-game-card/);
});
