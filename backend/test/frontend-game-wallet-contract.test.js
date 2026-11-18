"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("the two embedded slot games are the server-connected original game pages", () => {
  const app = read("index.html");
  const match = app.match(/const GB=\{([\s\S]*?)\};\s*const GM=/);
  assert.ok(match, "embedded game bundle must exist");
  for (const [key, endpoint] of [
    ["slot", "/games/ocean-storm/spin"],
    ["slot777", "/games/slot-777/spin"]
  ]) {
    const encoded = match[1].match(new RegExp(key + ':"([A-Za-z0-9+/=]+)"'));
    assert.ok(encoded, "missing embedded game " + key);
    const html = Buffer.from(encoded[1], "base64").toString("utf8");
    assert.ok(html.includes("migo:game-request"), key + " must request server settlement");
    assert.ok(html.includes(endpoint), key + " must use its matching server endpoint");
    assert.ok(!html.includes("bal=5000"), key + " must not mint a local fallback balance");
  }
});

test("the five external game pages request authoritative server outcomes", () => {
  const pages = [
    ["games/wheel-animals.html", "/games/wheel-animals/spin"],
    ["games/fruit-luck.html", "/games/fruit-luck/spin"],
    ["games/rocket-crash.html", "/games/rocket-crash/start"],
    ["games/cleopatra-gold.html", "/games/cleopatra-gold/spin"],
    ["games/big-warrior.html", "/games/big-warrior/fight"]
  ];
  for (const [file, endpoint] of pages) {
    const html = read(file);
    assert.ok(html.includes("migo:game-request"), file + " must request server settlement");
    assert.ok(html.includes(endpoint), file + " must use " + endpoint);
  }
});

test("the app bridge uses GET for rocket state and never accepts iframe balance writes", () => {
  const app = read("index.html");
  assert.match(app, /path\.endsWith\('\/state'\)\s*\?\s*'GET'\s*:\s*'POST'/);
  assert.match(app, /d\.t===\s*'set'[\s\S]{0,500}sendAuthoritativeGameWallet/);
  assert.doesNotMatch(app, /u\.coins\s*=\s*Math\.floor\(d\.v\)/);
});


test("room game launcher forwards authenticated game requests and never trusts iframe balances", () => {
  const launcher = read("scripts/apply-game-room-launcher.py");
  const bridge = read("api-bridge.js");
  assert.ok(launcher.includes('d.t==="migo:game-request"'));
  assert.ok(launcher.includes("window.__migoGameApiRequest"));
  assert.ok(launcher.includes('d.t==="migo:game-result"'));
  assert.ok(launcher.includes('d.t==="wallet-error"'));
  assert.ok(bridge.includes("const GAME_POST_PATHS = new Set"));
  assert.ok(bridge.includes("'Idempotency-Key': String(requestId)"));
  assert.ok(bridge.includes("window.__migoRefreshWallet = refreshWallet"));
  assert.ok(!launcher.includes("u.coins=Math.floor(d.v)"));
  assert.ok(!launcher.includes('postMessage({t:"bal",v:Number(profile.coins)||0}'));
});
