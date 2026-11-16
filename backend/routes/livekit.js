const express = require("express");
const { AccessToken } = require("livekit-server-sdk");
const Room = require("../models/Room");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

router.post("/:roomCode/token", async (req, res, next) => {
  try {
    const livekitUrl = String(process.env.LIVEKIT_URL || "").trim();
    const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
    const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
    if (!livekitUrl || !apiKey || !apiSecret) {
      return res.status(503).json({ ok: false, message: "خدمة الصوت الجديدة غير مهيأة بعد" });
    }

    const roomCode = Number(req.params.roomCode);
    if (!Number.isSafeInteger(roomCode)) {
      return res.status(400).json({ ok: false, message: "رقم الغرفة غير صحيح" });
    }

    const [room, user] = await Promise.all([
      Room.findOne({ roomCode, status: "open" }).select("roomCode owner members speakerSeats").lean(),
      User.findById(req.auth.sub).select("_id uid role").lean()
    ]);
    if (!room || !user || !room.members.some(id => String(id) === String(user._id))) {
      return res.status(403).json({ ok: false, message: "يجب أن تكون عضوًا في الغرفة أولاً" });
    }

    const canPublish = false; // Publish is granted only after the realtime mic lease is acquired.
    const roomName = "migo-room-" + roomCode;
    const identity = "migo-user-" + String(user._id);

    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity,
      ttl: "1h"
    });
    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canSubscribe: true,
      canPublish,
      canPublishData: false
    });

    const token = await accessToken.toJwt();
    res.set("Cache-Control", "no-store");
    return res.json({
      ok: true,
      serverUrl: livekitUrl,
      token,
      roomName,
      canPublish
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
