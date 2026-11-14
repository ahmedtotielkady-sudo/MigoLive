const express = require("express");
const User = require("../models/User");
const requireAuth = require("../middleware/requireAuth");
const router = express.Router();
router.use(requireAuth);

router.get("/:uid", async (req, res, next) => {
  try {
    const uid = Number(req.params.uid);
    if (!Number.isSafeInteger(uid) || uid < 1) return res.status(400).json({ ok: false, message: "رقم المستخدم غير صحيح" });
    const user = await User.findOne({ uid, status: "active" }).select("uid username displayName avatar role");
    if (!user) return res.status(404).json({ ok: false, message: "لم يتم العثور على المستخدم" });
    return res.json({ ok: true, user: {
      uid: user.uid, username: user.username, displayName: user.displayName,
      avatar: user.avatar || "", role: user.role
    } });
  } catch (error) { return next(error); }
});
module.exports = router;
