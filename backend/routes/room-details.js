const express = require("express");
const Room = require("../models/Room");
const RoomPresence = require("../models/RoomPresence");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

// Return a room's current persisted roster to authenticated members only.
router.get("/:roomCode", async (req, res, next) => {
  try {
    const roomCode = Number(req.params.roomCode);
    if (!Number.isSafeInteger(roomCode)) {
      return res.status(400).json({ ok: false, message: "رقم الغرفة غير صحيح" });
    }
    const room = await Room.findOne({ roomCode, status: "open" })
      .populate("owner", "uid displayName avatar")
      .populate("members", "uid displayName avatar role")
      .lean();
    if (!room) return res.status(404).json({ ok: false, message: "الغرفة غير موجودة أو مغلقة" });
    const isMember = room.members.some(member => String(member._id) === req.auth.sub);
    if (!isMember) return res.status(403).json({ ok: false, message: "انضم إلى الغرفة أولاً" });
    return res.json({
      ok: true,
      room: {
        id: room.roomCode,
        name: room.name,
        description: room.description,
        owner: room.owner ? {
          uid: room.owner.uid, displayName: room.owner.displayName, avatar: room.owner.avatar
        } : null,
        members: room.members.map(member => ({
          uid: member.uid, displayName: member.displayName, avatar: member.avatar, role: member.role
        })),
        membersCount: room.members.length,
        capacity: room.capacity,
        isPrivate: room.isPrivate,
        status: room.status,
        createdAt: room.createdAt
      }
    });
  } catch (error) { return next(error); }
});


router.get("/:roomCode/presence", async (req, res, next) => {
  try {
    const roomCode = Number(req.params.roomCode);
    if (!Number.isSafeInteger(roomCode)) {
      return res.status(400).json({ ok: false, message: "رقم الغرفة غير صحيح" });
    }
    const room = await Room.findOne({ roomCode, status: "open" })
      .select("members").lean();
    if (!room || !room.members.some(id => String(id) === req.auth.sub)) {
      return res.status(403).json({ ok: false, message: "انضم إلى الغرفة أولاً" });
    }
    const active = await RoomPresence.find({
      roomCode,
      expiresAt: { $gt: new Date() },
      userId: { $in: room.members }
    }).select("userId uid displayName").sort({ createdAt: 1 }).lean();
    const unique = new Map();
    for (const peer of active) {
      unique.set(String(peer.userId), {
        uid: peer.uid,
        displayName: peer.displayName || ""
      });
    }
    return res.json({ ok: true, roomCode, online: [...unique.values()] });
  } catch (error) { return next(error); }
});

module.exports = router;
