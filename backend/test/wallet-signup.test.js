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

test("signup grants 100 coins and creates the canonical wallet atomically", () => {
  const authRoute = read("routes/auth.js");
  assert.match(authRoute, /const INITIAL_SIGNUP_COINS = 100/);
  assert.match(authRoute, /coins:\s*INITIAL_SIGNUP_COINS/);
  assert.match(authRoute, /await dbSession\.withTransaction\(async \(\) => \{/);
  assert.match(authRoute, /await Wallet\.create\(\[/);
});

test("login never grants, debits, or resets coins", () => {
  const authRoute = read("routes/auth.js");
  const loginStart = authRoute.indexOf('router.post("/login"');
  const logoutStart = authRoute.indexOf('router.post("/logout"', loginStart);
  assert.notEqual(loginStart, -1);
  assert.notEqual(logoutStart, -1);
  const loginRoute = authRoute.slice(loginStart, logoutStart);
  assert.doesNotMatch(loginRoute, /coins\s*=|\$inc|INITIAL_SIGNUP_COINS|Wallet\.create/);
});

test("registration uses metadata-based international phone validation and email alternative", () => {
  const authRoute = read("routes/auth.js");
  assert.match(authRoute, /parsePhoneNumberFromString/);
  assert.match(authRoute, /getCountries\(\)/);
  assert.match(authRoute, /phoneCountry/);
  assert.match(authRoute, /normalizedEmail/);
  assert.match(authRoute, /email: email \|\| undefined/);
});
