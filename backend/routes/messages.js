const express = require("express");
const Message = require("../models/Message");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

router.get("/:uid", async (req, res, next) => {
  try {
    const uid = Number(req.params.uid);
    if (!Number.isSafeInteger(uid) || uid < 1) return res.status(400).json({ ok: false, message: "رقم المستخدم غير صحيح" });
    const peer = await User.findOne({ uid, status: "active" }).select("_id uid displayName avatar");
    if (!peer) return res.status(404).json({ ok: false, message: "المستخدم غير موجود" });
    if (String(peer._id) === req.auth.sub) return res.status(400).json({ ok: false, message: "لا يمكن فتح محادثة مع نفسك" });
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
    const before = req.query.before ? new Date(req.query.before) : null;
    const filter = {
      $or: [
        { from: req.auth.sub, to: peer._id },
        { from: peer._id, to: req.auth.sub }
      ]
    };
    if (before && !Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };
    const rows = await Message.find(filter).populate("from", "uid displayName").populate("to", "uid displayName").sort({ createdAt: -1 }).limit(limit + 1).lean();
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).reverse();
    const unreadIds = messages
      .filter(message => String(message.from?._id || message.from) === String(peer._id) && !message.readAt)
      .map(message => message._id);
    if (unreadIds.length) {
      await Message.updateMany(
        { _id: { $in: unreadIds }, to: req.auth.sub, readAt: null },
        { $set: { readAt: new Date() } }
      );
    }
    return res.json({
      ok: true,
      peer: { uid: peer.uid, displayName: peer.displayName, avatar: peer.avatar },
      messages,
      hasMore,
      nextBefore: hasMore && messages.length ? messages[0].createdAt : null
    });
  } catch (error) { return next(error); }
});

router.post("/:uid", async (req, res, next) => {
  try {
    const uid = Number(req.params.uid);
    const body = String(req.body.text || "").trim();
    if (!Number.isSafeInteger(uid) || uid < 1) return res.status(400).json({ ok: false, message: "رقم المستخدم غير صحيح" });
    if (!body || body.length > 2000) return res.status(400).json({ ok: false, message: "الرسالة فارغة أو أطول من المسموح" });
    const peer = await User.findOne({ uid, status: "active" }).select("_id");
    if (!peer) return res.status(404).json({ ok: false, message: "المستخدم غير موجود أو موقوف" });
    if (String(peer._id) === req.auth.sub) return res.status(400).json({ ok: false, message: "لا يمكن إرسال رسالة لنفسك" });
    const message = await Message.create({ from: req.auth.sub, to: peer._id, text: body });
    return res.status(201).json({ ok: true, message: {
      id: String(message._id), text: message.text, from: req.auth.uid,
      to: uid, createdAt: message.createdAt, readAt: message.readAt
    } });
  } catch (error) { return next(error); }
});

module.exports = router;
