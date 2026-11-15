"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../models/User");
const Wallet = require("../models/Wallet");

test("new User documents default to zero coins", () => {
  const user = new User({
    uid: 123456,
    username: "wallet_default_test",
    displayName: "Wallet Test",
    passwordHash: "not-a-real-password-hash"
  });
  assert.equal(user.coins, 0);
});

test("new Wallet documents default to zero balance", () => {
  const wallet = new Wallet({ userId: "507f1f77bcf86cd799439011" });
  assert.equal(wallet.balance, 0);
});

test("signup route grants 100 only on account creation; login does not mutate coins", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const authRoute = fs.readFileSync(path.join(__dirname, "../routes/auth.js"), "utf8");
  assert.match(authRoute, /const INITIAL_SIGNUP_COINS = 100/);
  assert.match(authRoute, /coins:\s*INITIAL_SIGNUP_COINS/);
  const loginRoute = authRoute.slice(authRoute.indexOf('router.post("/login"'), authRoute.indexOf('const crypto = require("crypto")'));
  assert.doesNotMatch(loginRoute, /coins\s*=|\$inc|INITIAL_SIGNUP_COINS/);
});
