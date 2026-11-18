"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("all seven games are present in the API catalog and remain gated", () => {
  const source = read("routes/games.js");
  const ids = ["slot-777","ocean-storm","wheel-animals","cleopatra-gold","fruit-luck","rocket-crash","big-warrior"];
  for (const id of ids) {
    assert.match(source, new RegExp('id:"' + id + '"'));
    assert.match(source, new RegExp('id:"' + id + '".*?active:false'));
  }
});

test("server mounts each authoritative game router once and not the legacy experimental router", () => {
  const source = read("server.js");
  for (const router of ["games","ocean-storm","cleopatra-gold","big-warrior","wheel-fruit","rocket-crash"]) {
    assert.equal((source.match(new RegExp('require\\("./routes/' + router + '"\\)', "g")) || []).length, 1);
  }
  assert.doesNotMatch(source, /require\("\.\/routes\/server-games"\)/);
});

test("animal wheel and fruit settlement use server engines and atomic wallet ledger transactions", () => {
  const source = read("routes/wheel-fruit.js");
  assert.match(source, /router\.post\("\/wheel-animals\/spin"/);
  assert.match(source, /router\.post\("\/fruit-luck\/spin"/);
  assert.match(source, /engine\.play\(parsed\.requestedBets\)/);
  assert.match(source, /session\.withTransaction/);
  assert.match(source, /WalletTransaction\.create/);
  assert.match(source, /Wallet\.updateOne/);
  assert.match(source, /router\.use\(requireAuth\)/);
  assert.match(source, /idempotency-key/);
});

test("rocket state is read-only GET and cashout/cancel are server-settled transactions", () => {
  const source = read("routes/rocket-crash.js");
  assert.match(source, /router\.get\("\/rocket-crash\/state"/);
  assert.match(source, /router\.post\(\["\/rocket-crash\/cashout"/);
  assert.match(source, /router\.post\("\/rocket-crash\/cancel"/);
  assert.match(source, /session\.withTransaction/);
  assert.match(source, /engine\.generateCrashPoint\(\)/);
  assert.match(source, /engine\.multiplierAt/);
  assert.match(source, /type: "game_refund"/);
  assert.doesNotMatch(source, /res\.json\([^\n]*crashAtMultiplier/);
});

test("all other game endpoints are authenticated and settle against the same wallet ledger", () => {
  const checks = [
    ["routes/games.js", "/slot-777/spin"],
    ["routes/ocean-storm.js", "/ocean-storm/spin"],
    ["routes/cleopatra-gold.js", "/cleopatra-gold/spin"],
    ["routes/big-warrior.js", "/big-warrior/fight"]
  ];
  for (const [file, endpoint] of checks) {
    const source = read(file);
    assert.ok(source.includes(endpoint), file + " missing " + endpoint);
    assert.match(source, /router\.use\(requireAuth\)/, file + " must require authentication");
    assert.match(source, /session\.withTransaction/, file + " must settle in a transaction");
    assert.match(source, /WalletTransaction\.create/, file + " must write the ledger");
    assert.match(source, /Wallet\.updateOne/, file + " must sync wallet mirror");
  }
});


test("rocket polling stays below the shared game API rate limit and wallet errors are visible", () => {
  const rocket = read("../games/rocket-crash.html");
  const server = read("server.js");
  assert.match(rocket, /lastStatePoll>=1500/);
  assert.ok(server.includes('app.use("/api/games", rateLimit({ windowMs: 60_000, limit: 90'));
  assert.match(rocket, /walletError=String\\(d\\.message/);
  assert.match(rocket, /if\\(walletError\\)\\{m\\.className='w'/);
});
