const express = require("express");
const bcrypt = require("bcryptjs");
const Counter = require("../models/Counter");
const Room = require("../models/Room");
const RoomPresence = require("../models/RoomPresence");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

function roomView(room, userId) {
  return {
    id: room.roomCode, name: room.name, description: room.description,
    ownerUid: room.owner?.uid, membersCount: room.members.length,
    capacity: room.capacity, isPrivate: room.isPrivate,
    isMember: room.members.some(id => String(id._id || id) === userId),
    status: room.status, createdAt: room.createdAt
  };
}

router.get("/", async (req, res, next) => {
  try {
    const rooms = await Room.find({ status: "open" })
      .select("roomCode name description owner members capacity isPrivate status createdAt")
      .populate("owner", "uid displayName")
      .sort({ updatedAt: -1 }).limit(100).lean();
    return res.json({ ok: true, rooms: rooms.map(r => roomView(r, req.auth.sub)) });
  } catch (error) { return next(error); }
});

router.post("/", async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim().slice(0, 240);
    const isPrivate = req.body.isPrivate === true;
    const password = String(req.body.password || "");
    const requestedCapacity = Number(req.body.capacity);
    const capacity = Number.isInteger(requestedCapacity)
      ? Math.min(25, Math.max(2, requestedCapacity))
      : 25;
    if (name.length < 2 || name.length > 50) {
      return res.status(400).json({ ok: false, message: "اسم الغرفة يجب أن يكون من حرفين إلى 50 حرفاً" });
    }
    if (isPrivate && password.length < 4) {
      return res.status(400).json({ ok: false, message: "كلمة مرور الغرفة يجب ألا تقل عن 4 أحرف" });
    }
    const counter = await Counter.findOneAndUpdate(
      { _id: "roomCode" }, { $inc: { value: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const room = await Room.create({
      roomCode: 200000 + counter.value, name, description,
      owner: req.auth.sub, members: [req.auth.sub], isPrivate,
      passwordHash: isPrivate ? await bcrypt.hash(password, 10) : "",
      capacity
    });
    await room.populate("owner", "uid displayName");
    return res.status(201).json({ ok: true, room: roomView(room, req.auth.sub) });
  } catch (error) { return next(error); }
});

router.post("/:roomCode/join", async (req, res, next) => {
  try {
    const roomCode = Number(req.params.roomCode);
    if (!Number.isSafeInteger(roomCode)) return res.status(400).json({ ok: false, message: "رقم الغرفة غير صحيح" });
    const room = await Room.findOne({ roomCode, status: "open" });
    if (!room) return res.status(404).json({ ok: false, message: "الغرفة غير موجودة أو مغلقة" });
    if (room.isPrivate && !(await bcrypt.compare(String(req.body.password || ""), room.passwordHash))) {
      return res.status(403).json({ ok: false, message: "كلمة مرور الغرفة غير صحيحة" });
    }
    const already = room.members.some(id => String(id) === req.auth.sub);
    if (!already && room.members.length >= room.capacity) {
      return res.status(409).json({ ok: false, message: "الغرفة ممتلئة" });
    }
    if (!already) {
      // Empty rooms remain open. The first person to return becomes the new owner.
      const updated = await Room.findOneAndUpdate(
        {
          _id: room._id, status: "open", members: { $ne: req.auth.sub },
          $expr: { $lt: [{ $size: "$members" }, "$capacity"] }
        },
        [
          {
            $set: {
              members: { $concatArrays: [{ $ifNull: ["$members", []] }, [new (require("mongoose").Types.ObjectId)(req.auth.sub)]] },
              owner: {
                $cond: [
                  { $eq: [{ $size: { $ifNull: ["$members", []] } }, 0] },
                  new (require("mongoose").Types.ObjectId)(req.auth.sub),
                  "$owner"
                ]
              }
            }
          }
        ],
        { new: true }
      ).populate("owner", "uid displayName");
      if (!updated) return res.status(409).json({ ok: false, message: "تعذر الانضمام؛ قد تكون الغرفة امتلأت" });
      return res.json({ ok: true, room: roomView(updated, req.auth.sub) });
    }
    await room.populate("owner", "uid displayName");
    return res.json({ ok: true, room: roomView(room, req.auth.sub) });
  } catch (error) { return next(error); }
});

router.post("/:roomCode/leave", async (req, res, next) => {
  try {
    const room = await Room.findOne({ roomCode: Number(req.params.roomCode) });
    if (!room) return res.status(404).json({ ok: false, message: "الغرفة غير موجودة" });
    const wasOwner = String(room.owner) === req.auth.sub;
    room.members.pull(req.auth.sub);
    room.speakerSeats = (room.speakerSeats || []).filter(seat => String(seat.userId) !== req.auth.sub);

    // A room is independent from its current host/microphone holder.
    // If the owner leaves, promote the next remaining member instead of closing the room.
    let newOwnerUid = null;
    if (wasOwner && room.members.length > 0) {
      const nextOwnerId = room.members[0];
      room.owner = nextOwnerId;
      const nextOwner = await User.findById(nextOwnerId).select("uid").lean();
      newOwnerUid = nextOwner?.uid ?? null;
    }
    await room.save();
    await RoomPresence.deleteMany({ roomCode: Number(room.roomCode), userId: req.auth.sub });

    const io = req.app.get("io");
    if (io) {
      io.to("room:" + room.roomCode).emit("room:peer-left", { uid: Number(req.auth.uid), reason: "left" });
      io.to("room:" + room.roomCode).emit("mic:state", { uid: Number(req.auth.uid), enabled: false });
      if (wasOwner && newOwnerUid !== null) {
        io.to("room:" + room.roomCode).emit("room:host-changed", {
          roomCode: room.roomCode, ownerUid: newOwnerUid
        });
      }
      // Remove every live socket belonging to the leaver from this room.
      // Disconnect triggers the realtime cleanup path for stale peers and mic state.
      const roomSockets = await io.in("room:" + room.roomCode).fetchSockets();
      for (const peer of roomSockets) {
        if (String(peer.auth?.sub) === String(req.auth.sub)) {
          peer.leave("room:" + room.roomCode);
          peer.disconnect(true);
        }
      }
      const remainingSeats = await Room.findById(room._id).select("speakerSeats").lean();
      if (remainingSeats) {
        const ids = remainingSeats.speakerSeats.map(seat => seat.userId);
        const users = await User.find({ _id: { $in: ids } }).select("_id uid").lean();
        const uidById = new Map(users.map(user => [String(user._id), user.uid]));
        io.to("room:" + room.roomCode).emit("seats:state", {
          seats: remainingSeats.speakerSeats.map(seat => ({
            seat: seat.seat, uid: uidById.get(String(seat.userId))
          })).filter(seat => Number.isSafeInteger(Number(seat.uid)))
        });
      }
    }
    return res.json({ ok: true, closed: false, ownerUid: newOwnerUid });
  } catch (error) { return next(error); }
});

module.exports = router;
