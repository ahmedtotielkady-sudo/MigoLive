const test = require("node:test");
const assert = require("node:assert/strict");
const { TrackSource } = require("livekit-server-sdk");

test("LiveKit microphone permission uses the SDK protobuf enum", () => {
  assert.equal(typeof TrackSource.MICROPHONE, "number");
  assert.equal(TrackSource.MICROPHONE, 2);
  assert.notEqual(TrackSource.MICROPHONE, "microphone");
});
