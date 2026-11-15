"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("User and Wallet model defaults never mint signup coins", () => {
  const userModel = read("models/User.js");
  const walletModel = read("models/Wallet.js");
  assert.match(userModel, /coins:\s*\{[^}]*default:\s*0/);
  assert.match(walletModel, /balance:\s*\{[^}]*default:\s*0/);
});

test("signup grants 100 coins and login never changes the balance", () => {
  const authRoute = read("routes/auth.js");
  assert.match(authRoute, /const INITIAL_SIGNUP_COINS = 100/);
  assert.match(authRoute, /coins:\s*INITIAL_SIGNUP_COINS/);
  assert.match(authRoute, /\$setOnInsert:\s*\{\s*userId:\s*user\._id,\s*balance:\s*INITIAL_SIGNUP_COINS/);
  const loginRoute = authRoute.slice(authRoute.indexOf('router.post("/login"'), authRoute.indexOf('const crypto = require("crypto")'));
  assert.doesNotMatch(loginRoute, /coins\s*=|\$inc|INITIAL_SIGNUP_COINS/);
});
