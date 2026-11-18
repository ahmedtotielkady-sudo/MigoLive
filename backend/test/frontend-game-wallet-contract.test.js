"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("both embedded slot games use their matching server settlement endpoints", () => {
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

test("every game opened by the room launcher uses the matching server API", () => {
  const pages = [
    ["wheel-animals.html", "/games/wheel-animals/spin"],
    ["slot-ocean-storm.html", "/games/ocean-storm/spin"],
    ["slot-777.html", "/games/slot-777/spin"],
    ["games/cleopatra-gold.html", "/games/cleopatra-gold/spin"],
    ["games/fruit-luck.html", "/games/fruit-luck/spin"],
    ["games/rocket-crash.html", "/games/rocket-crash/start"],
    ["games/big-warrior.html", "/games/big-warrior/fight"]
  ];
  for (const [file, endpoint] of pages) {
    const html = read(file);
    assert.ok(html.includes("migo:game-request"), file + " must request server settlement");
    assert.ok(html.includes(endpoint), file + " must use " + endpoint);
  }
});

test("Animal Wheel never settles bets or changes the wallet in the browser", () => {
  const html = read("wheel-animals.html");
  assert.ok(html.includes("path:'/games/wheel-animals/spin'"));
  assert.ok(html.includes("body:{bets:bets.slice()}"));
  assert.ok(html.includes("bal=Number(data.coins)"));
  assert.doesNotMatch(html, /bal\s*\+=\s*p/);
  assert.doesNotMatch(html, /postMessage\(\{t:'set',v:bal/);
});

test("Rocket Crash has a safe request-id fallback and visible wallet failure state", () => {
  const html = read("games/rocket-crash.html");
  assert.ok(html.includes("const makeRequestId="));
  assert.ok(html.includes("e.source!==window.parent"));
  assert.ok(html.includes("d.t==='wallet-error'"));
  assert.ok(html.includes("dialog.showModal()"));
  assert.ok(html.includes("/games/rocket-crash/cashout"));
  assert.ok(html.includes("/games/rocket-crash/state"));
});

test("room game launcher forwards authenticated requests and ignores iframe balance writes", () => {
  const launcher = read("scripts/apply-game-room-launcher.py");
  const bridge = read("api-bridge.js");
  assert.ok(launcher.includes('d.t==="migo:game-request"'));
  assert.ok(launcher.includes("window.__migoGameApiRequest"));
  assert.ok(launcher.includes('"migo:game-result"'));
  assert.ok(launcher.includes('"wallet-error"'));
  assert.ok(bridge.includes("const GAME_POST_PATHS = new Set"));
  assert.ok(bridge.includes("'Idempotency-Key': String(requestId)"));
  assert.ok(bridge.includes("window.__migoRefreshWallet = refreshWallet"));
  assert.ok(!launcher.includes("u.coins=Math.floor(d.v)"));
  assert.ok(!launcher.includes('postMessage({t:"bal",v:Number(profile.coins)||0}'));
});

test("app wallet uses one canonical no-cache server balance", () => {
  const bridge = read("api-bridge.js");
  const wallet = read("backend/routes/wallet.js");
  assert.ok(bridge.includes("function syncWalletBalance(value)"));
  assert.ok(bridge.includes("api('/wallet', { method: 'GET', cache: 'no-store' })"));
  assert.ok(bridge.includes("window.__migoSyncWalletBalance = syncWalletBalance"));
  assert.ok(bridge.includes("await refreshWallet()"));
  assert.ok(bridge.includes("'[data-wallet-balance]'"));
  assert.ok(wallet.includes('Cache-Control", "no-store, no-cache, must-revalidate, private'));
  assert.ok(wallet.includes('User.findById(req.auth.sub).select("uid coins")'));
});
