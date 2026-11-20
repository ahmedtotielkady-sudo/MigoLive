"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "../../games/slot-777.html"), "utf8");

test("Slot 777 sends spins through the authenticated server game RPC", () => {
  assert.match(html, /migoGameCall\('slot-777','spin',\{bet\}\)/);
  assert.match(html, /t:'migo:game:request',gameId,action,payload,requestId/);
  assert.match(html, /t!=='migo:game:response'/);
  assert.doesNotMatch(html, /migo:game:slot-777:spin/);
  assert.doesNotMatch(html, /migo:game:slot-777:result/);
});

test("Slot 777 renders the server outcome and server wallet balance", () => {
  assert.match(html, /serverRound\.outcome/);
  assert.match(html, /serverRound\.coins/);
  assert.match(html, /serverRound\.payout/);
});
