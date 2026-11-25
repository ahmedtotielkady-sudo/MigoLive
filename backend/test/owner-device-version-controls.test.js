"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

test("device inventory stores a one-way key and exposes owner-only block controls", () => {
  const model = read("models/Device.js");
  const route = read("routes/admin-devices.js");
  const auth = read("middleware/requireAuth.js");
  const device = read("utils/device.js");
  assert.match(model, /deviceKey:.*unique/);
  assert.doesNotMatch(model, /rawDeviceId/);
  assert.match(route, /actor\.role !== "owner"/);
  assert.match(route, /router\.post\("\/:id\/block"/);
  assert.match(route, /router\.post\("\/:id\/unblock"/);
  assert.match(device, /createHmac\("sha256"/);
  assert.match(auth, /DEVICE_BANNED/);
  assert.match(auth, /claims\.did/);
});

test("login registers devices and binds new sessions to their device key", () => {
  const auth = read("routes/auth.js");
  const bridge = fs.readFileSync(path.join(__dirname, "..", "..", "api-bridge.js"), "utf8");
  assert.match(auth, /registerDevice\(req, user\)/);
  assert.match(auth, /did: deviceKey/);
  assert.match(bridge, /X-Migo-Device-ID/);
  assert.match(bridge, /X-Migo-Device-Model/);
});

test("owner can observe and block individual app versions", () => {
  const route = read("routes/app-update.js");
  const model = read("models/AppUpdatePolicy.js");
  const bridge = fs.readFileSync(path.join(__dirname, "..", "..", "api-bridge.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "..", "index.html"), "utf8");
  assert.match(model, /blockedVersions/);
  assert.match(model, /versions:/);
  assert.match(route, /router\.put\("\/versions", requireAuth, ownerOnly/);
  assert.match(route, /current\.versions\.push/);
  assert.match(bridge, /blockedVersions\.includes\(installed\)/);
  assert.match(html, /إدارة الإصدارات/);
  assert.match(html, /الأجهزة والحظر/);
});
