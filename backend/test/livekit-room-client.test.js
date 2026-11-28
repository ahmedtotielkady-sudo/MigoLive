"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../..");

test("Android room UI loads the LiveKit and Socket.IO audio bridge", () => {
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/android-preview.yml"), "utf8");
  const bridge = fs.readFileSync(path.join(root, "voice-room.js"), "utf8");
  assert.ok(workflow.includes("livekit-client@2.25.0"));
  assert.ok(workflow.includes("cp voice-room.js www/voice-room.js"));
  assert.ok(workflow.includes("android.permission.RECORD_AUDIO"));
  assert.ok(workflow.includes("android.permission.MODIFY_AUDIO_SETTINGS"));
  assert.ok(bridge.includes("window.io(origin"));
  assert.ok(bridge.includes('"/rooms/livekit/" + roomCode + "/token"'));
  assert.ok(!bridge.includes('apiRequest("/rooms/" + roomCode + "/join"'));
  assert.ok(bridge.includes("local.serverMember = remote.isMember === true"));
});

test("room membership and seat actions are confirmed by the server before local UI changes", () => {
  const bridge = fs.readFileSync(path.join(root, "voice-room.js"), "utf8");
  assert.ok(bridge.includes('emitAck(socket, "room:join"'));
  assert.ok(bridge.includes('emitAck(voiceSession.socket, "seat:take"'));
  assert.ok(bridge.includes('emitAck(voiceSession.socket, "seat:leave"'));
  assert.ok(bridge.includes('emitAck(session.socket, "mic:state"'));
});

test("LiveKit audio is attached for remote tracks and local publishing requires server permission", () => {
  const bridge = fs.readFileSync(path.join(root, "voice-room.js"), "utf8");
  assert.ok(bridge.includes("events.TrackSubscribed"));
  assert.ok(bridge.includes("track.attach()"));
  assert.ok(bridge.includes("response.enabled !== true"));
  assert.ok(bridge.includes("setMicrophoneEnabled(true)"));
});

test("Capacitor localhost origins are allowed by the API and realtime CORS gates", () => {
  const server = fs.readFileSync(path.join(root, "backend/server.js"), "utf8");
  const realtime = fs.readFileSync(path.join(root, "backend/realtime.js"), "utf8");
  for (const origin of ["https://localhost", "http://localhost", "capacitor://localhost"]) {
    assert.ok(server.includes(origin));
    assert.ok(realtime.includes(origin));
  }
});
