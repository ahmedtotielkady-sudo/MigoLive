const router = require("express").Router();
const auth = require("../middleware/auth");
const Agency = require("../models/Agency");

router.use(auth);

// Host-agency requests never grant wallet, top-up, or shipping permissions.
router.post("/host-request", async (req, res, next) => {
  const name = String(req.body.name || "").trim();
  if (name.length < 2 || name.length > 60) {
    return res.status(400).json({ error: "Agency name must be 2-60 characters" });
  }
  try {
    const existing = await Agency.findOne({
      type: "host",
      ownerId: req.user._id,
      status: { $in: ["pending", "active"] }
    }).select("_id status name");
    if (existing) return res.status(409).json({ error: "A host agency request or active agency already exists", agency: existing });
    const agency = await Agency.create({
      name,
      type: "host",
      status: "pending",
      ownerId: req.user._id
    });
    return res.status(201).json({ success: true, agency });
  } catch (error) { return next(error); }
});

router.get("/me", async (req, res, next) => {
  try {
    const agencies = await Agency.find({
      $or: [{ ownerId: req.user._id }, { "members.userId": req.user._id }]
    }).select("name type status ownerId members createdAt").lean();
    // Deliberately return agency membership only. It does not imply recharge authority.
    return res.json({ agencies });
  } catch (error) { return next(error); }
});

module.exports = router;
