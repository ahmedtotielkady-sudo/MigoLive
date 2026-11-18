"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const walletRoute = fs.readFileSync(
  path.join(__dirname, "..", "routes", "wallet.js"),
  "utf8"
);

test("wallet transfer handles a concurrent idempotency-key collision without a second debit", () => {
  const transfer = walletRoute.slice(
    walletRoute.indexOf('router.post("/transfer"'),
    walletRoute.indexOf('router.post("/admin/credit"')
  );
  assert.match(transfer, /error\.code === 11000/);
  assert.match(transfer, /existing\.amount === amount && existing\.type === type/);
  assert.match(transfer, /repeated: true/);
  assert.match(transfer, /status\(409\)/);
});

test("owner/admin credit handles a concurrent retry without a second credit", () => {
  const credit = walletRoute.slice(walletRoute.indexOf('router.post("/admin/credit"'));
  assert.match(credit, /error\.code === 11000/);
  assert.match(credit, /existing\.type === "admin_adjustment"/);
  assert.match(credit, /existing\.amount === amount/);
  assert.match(credit, /repeated: true/);
  assert.match(credit, /status\(409\)/);
});

test("wallet credits and transfers remain inside MongoDB transactions", () => {
  assert.match(walletRoute, /await session\.withTransaction\(async \(\) => \{/g);
  assert.match(walletRoute, /idempotencyKey: key/);
  assert.match(walletRoute, /\$inc: \{ coins: amount \}/);
  assert.match(walletRoute, /\$inc: \{ coins: -amount \}/);
});
