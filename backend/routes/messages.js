const router = require("express").Router();
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const auth = require("../middleware/auth");
const User = require("../models/User");
const Message = require("../models/Message");

const sendLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: req => String(req.user?._id || req.ip),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages. Please wait a minute." }
});

router.use(auth);

function validUserId(value) {
  return mongoose.isValidObjectId(value);
}

// Search a recipient by their public account ID (MongoDB user ID).
router.get("/users/:userId", async (req, res, next) => {
  try {
    if (!validUserId(req.params.userId)) return res.status(400).json({ error: "Invalid user ID" });
    const user = await User.findOne({ _id: req.params.userId, status: "active" }).select("_id username");
    if (!user) return res.status(404).json({ error: "User not found" });
    res.json({ user: { id: user._id, username: user.username } });
  } catch (e) { next(e); }
});

// List recent conversations for the signed-in account.
router.get("/conversations", async (req, res, next) => {
  try {
    const me = req.user._id;
    const messages = await Message.find({ $or: [{ senderId: me }, { recipientId: me }] })
      .sort({ createdAt: -1 }).limit(500).lean();
    const latest = new Map();
    for (const message of messages) {
      const otherId = String(message.senderId) === String(me) ? String(message.recipientId) : String(message.senderId);
      if (!latest.has(otherId)) latest.set(otherId, message);
    }
    const ids = [...latest.keys()];
    const users = await User.find({ _id: { $in: ids }, status: "active" }).select("_id username").lean();
    const byId = new Map(users.map(user => [String(user._id), user]));
    const conversations = ids.filter(id => byId.has(id)).map(id => {
      const message = latest.get(id);
      return {
        user: { id, username: byId.get(id).username },
        lastMessage: { body: message.body, senderId: message.senderId, createdAt: message.createdAt },
        unreadCount: messages.filter(m => String(m.senderId) === id && String(m.recipientId) === String(me) && !m.readAt).length
      };
    });
    res.json({ conversations });
  } catch (e) { next(e); }
});

// Read a conversation and mark incoming messages as read.
router.get("/with/:userId", async (req, res, next) => {
  try {
    const otherId = req.params.userId;
    if (!validUserId(otherId)) return res.status(400).json({ error: "Invalid user ID" });
    if (String(otherId) === String(req.user._id)) return res.status(400).json({ error: "Cannot open a conversation with yourself" });
    const other = await User.findOne({ _id: otherId, status: "active" }).select("_id username");
    if (!other) return res.status(404).json({ error: "User not found" });
    const me = req.user._id;
    const filter = { $or: [{ senderId: me, recipientId: other._id }, { senderId: other._id, recipientId: me }] };
    const messages = await Message.find(filter).sort({ createdAt: -1 }).limit(100).lean();
    await Message.updateMany({ senderId: other._id, recipientId: me, readAt: null }, { $set: { readAt: new Date() } });
    res.json({
      user: { id: other._id, username: other.username },
      messages: messages.reverse().map(m => ({
        id: m._id, senderId: m.senderId, recipientId: m.recipientId,
        body: m.body, readAt: m.readAt, createdAt: m.createdAt
      }))
    });
  } catch (e) { next(e); }
});

// Persist a message in MongoDB; the receiver can retrieve it from any device.
router.post("/with/:userId", sendLimit, async (req, res, next) => {
  try {
    const otherId = req.params.userId;
    const body = String(req.body.body || "").trim();
    if (!validUserId(otherId)) return res.status(400).json({ error: "Invalid user ID" });
    if (String(otherId) === String(req.user._id)) return res.status(400).json({ error: "Cannot message yourself" });
    if (!body || body.length > 2000) return res.status(400).json({ error: "Message must be 1–2000 characters" });
    const recipient = await User.findOne({ _id: otherId, status: "active" }).select("_id");
    if (!recipient) return res.status(404).json({ error: "Recipient not found" });
    const message = await Message.create({ senderId: req.user._id, recipientId: recipient._id, body });
    res.status(201).json({
      message: {
        id: message._id, senderId: message.senderId, recipientId: message.recipientId,
        body: message.body, createdAt: message.createdAt
      }
    });
  } catch (e) { next(e); }
});

module.exports = router;
