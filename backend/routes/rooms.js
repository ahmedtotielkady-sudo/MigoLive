const express = require("express");
const bcrypt = require("bcryptjs");
const Counter = require("../models/Counter");
const Room = require("../models/Room");
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
      capacity: Math.min(25, Math.max(2, Number(req.body.capacity) || 25))
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
      const updated = await Room.findOneAndUpdate(
        { _id: room._id, status: "open", members: { $ne: req.auth.sub }, $expr: { $lt: [{ $size: "$members" }, "$capacity"] } },
        { $addToSet: { members: req.auth.sub } }, { new: true }
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
    if (String(room.owner) === req.auth.sub) {
      room.status = "closed";
      room.members = [];
      room.speakerSeats = [];
    } else {
      room.members.pull(req.auth.sub);
      room.speakerSeats = (room.speakerSeats || []).filter(seat => String(seat.userId) !== req.auth.sub);
    }
    await room.save();
    return res.json({ ok: true, closed: room.status === "closed" });
  } catch (error) { return next(error); }
});

module.exports = router;
