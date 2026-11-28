const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TrackSource } = require("livekit-server-sdk");

test("LiveKit room token grants microphone publishing with the SDK enum", () => {
  const route = fs.readFileSync(path.join(__dirname, "../routes/livekit.js"), "utf8");
  assert.match(route, /canPublishSources:\s*\[TrackSource\.MICROPHONE\]/);
  assert.equal(typeof TrackSource.MICROPHONE, "number");
  assert.match(route, /ttl:\s*"15m"/);
  assert.match(route, /user\.status !== "active"/);
});
