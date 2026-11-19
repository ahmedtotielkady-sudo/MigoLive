"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getCountries, getCountryCallingCode, parsePhoneNumberFromString } = require("libphonenumber-js/max");
const fs = require("node:fs");
const path = require("node:path");

test("country catalog exposes calling codes for worldwide signup", () => {
  const countries = getCountries();
  assert.ok(countries.length > 200);
  for (const code of ["EG", "US", "GB", "SA", "AE", "IN", "BR", "JP"]) {
    assert.ok(countries.includes(code), code + " must be available");
    assert.match(getCountryCallingCode(code), new RegExp("^" + slash + "d{1,3}$"));
  }
});

test("local mobile numbers normalize to E.164 for selected countries", () => {
  const cases = [
    ["01131068538", "EG", "+201131068538"],
    ["2025550123", "US", "+12025550123"],
    ["02079460056", "GB", "+442079460056"],
    ["0501234567", "SA", "+966501234567"],
    ["0501234567", "AE", "+971501234567"]
  ];
  for (const [input, country, expected] of cases) {
    const parsed = parsePhoneNumberFromString(input, country);
    assert.ok(parsed && parsed.isValid(), country + " " + input);
    assert.equal(parsed.number, expected);
  }
});

test("invalid phone numbers are rejected by the same metadata validator", () => {
  for (const [input, country] of [["123", "EG"], ["011123", "EG"], ["abc", "US"]]) {
    const parsed = parsePhoneNumberFromString(input, country);
    assert.ok(!parsed || !parsed.isValid());
  }
});

test("auth route uses country-aware E.164 normalization and email identity", () => {
  const authRoute = fs.readFileSync(path.join(__dirname, "..", "routes", "auth.js"), "utf8");
  assert.match(authRoute, /parsePhoneNumberFromString/);
  assert.match(authRoute, /getCountries\(\)/);
  assert.match(authRoute, /phoneCountry/);
  assert.match(authRoute, /normalizedEmail/);
  assert.match(authRoute, /أدخل رقم الهاتف أو البريد الإلكتروني/);
});
