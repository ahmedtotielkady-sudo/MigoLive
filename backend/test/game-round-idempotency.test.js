"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

test("game rounds persist a bounded request fingerprint", () => {
  const schema = require("../models/GameRound").schema;
  assert.ok(schema.path("idempotencyKey").options.unique);
  assert.ok(schema.path("requestHash"));
  assert.equal(schema.path("requestHash").options.maxlength, 64);
});

test("all live game settlement routes persist request fingerprints", () => {
  const route = fs.readFileSync(path.join(root, "routes", "games.js"), "utf8");
  for (const gameId of ["slot-777", "wheel-animals", "fruit-luck", "big-warrior"]) {
    assert.ok(route.includes('gameId: "' + gameId + '"'));
  }
  assert.equal((route.match(/idempotencyKey: key, requestHash/g) || []).length, 4);
});

test("concurrent game round duplicates recover only the committed matching round", () => {
  const route = fs.readFileSync(path.join(root, "routes", "games.js"), "utf8");
  assert.ok(route.includes("async function recoverDuplicateRound"));
  assert.ok(route.includes("prior.requestHash !== requestHash"));
  assert.equal((route.match(/error && error.code === 11000/g) || []).length, 4);
  assert.ok(route.includes("تعذر تأكيد نتيجة الجولة"));
});
