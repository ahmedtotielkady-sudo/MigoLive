const test = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-secret-with-at-least-thirty-two-characters";
const userModulePath = require.resolve("../models/User");
const originalUserModule = require.cache[userModulePath];
let activeSessionId = "session-1";
require.cache[userModulePath] = {
  id: userModulePath,
  filename: userModulePath,
  loaded: true,
  exports: {
    exists: async filter => filter.activeSessionId === activeSessionId && filter.activeSessionExpiresAt?.$gt instanceof Date
  }
};

const requireAuth = require("../middleware/requireAuth");

function requestFor(token) {
  return { headers: { authorization: "Bearer " + token } };
}

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

function token(sid = "session-1") {
  return jwt.sign(
    { sub: "user-1", uid: 100001, sid },
    process.env.JWT_SECRET,
    { expiresIn: "1h", issuer: "migolive-api", audience: "migolive-app" }
  );
}

test("allows the currently active account session", async () => {
  activeSessionId = "session-1";
  const req = requestFor(token());
  const res = response();
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.auth.sid, "session-1");
});

test("rejects a token after another device replaces its session", async () => {
  activeSessionId = "new-session";
  const req = requestFor(token("old-session"));
  const res = response();
  let nextCalled = false;
  await requireAuth(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, "SESSION_REPLACED");
});

test("rejects legacy tokens without a session identifier", async () => {
  activeSessionId = "session-1";
  const legacy = jwt.sign(
    { sub: "user-1", uid: 100001 },
    process.env.JWT_SECRET,
    { expiresIn: "1h", issuer: "migolive-api", audience: "migolive-app" }
  );
  const req = requestFor(legacy);
  const res = response();
  await requireAuth(req, res, () => assert.fail("legacy token must not be accepted"));
  assert.equal(res.statusCode, 401);
});

test.after(() => {
  if (originalUserModule) require.cache[userModulePath] = originalUserModule;
  else delete require.cache[userModulePath];
});
