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
  assert.match(authRoute, /Wallet\.create\(\[\{\s*userId:\s*user\._id,\s*balance:\s*INITIAL_SIGNUP_COINS\s*\}\],\s*\{\s*session:\s*dbSession\s*\}\)/);
  const loginStart = authRoute.indexOf('router.post("/login"');
  const loginEnd = authRoute.indexOf("const OwnerClaim = require", loginStart);
  const loginRoute = authRoute.slice(loginStart, loginEnd);
  assert.doesNotMatch(loginRoute, /coins\s*=|\$inc|INITIAL_SIGNUP_COINS/);
});


test("signup username validator accepts ordinary Arabic and Latin names from 3 characters", () => {
  const authRoute = read("routes/auth.js");
  assert.ok(authRoute.includes(String.raw\`/^[\p{L}\p{N}_.-]{3,24}$/u\`));
  const usernamePattern = /^[\p{L}\p{N}_.-]{3,24}$/u;
  assert.equal(usernamePattern.test("Ali"), true);
  assert.equal(usernamePattern.test("محمد"), true);
  assert.equal(usernamePattern.test("abc123"), true);
  assert.equal(usernamePattern.test("ab"), false);
  assert.equal(usernamePattern.test("a".repeat(25)), false);
  assert.equal(usernamePattern.test("ab!"), false);
});

test("signup phone validator accepts optional plus and 7-15 digits", () => {
  const authRoute = read("routes/auth.js");
  assert.ok(authRoute.includes(String.raw\`/^\\+?[0-9]{7,15}$/\`));
  const phonePattern = /^\+?[0-9]{7,15}$/;
  assert.equal(phonePattern.test("01131068538"), true);
  assert.equal(phonePattern.test("+201131068538"), true);
  assert.equal(phonePattern.test("123"), false);
});
