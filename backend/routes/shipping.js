const router = require("express").Router();
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const Agency = require("../models/Agency");
const User = require("../models/User");
const { executeTransaction } = require("../services/walletService");

router.use(auth);

// Only active shipping-agency members or administrators may credit another user's wallet.
router.post("/topups", async (req, res) => {
  const targetId = String(req.body.userId || "");
  const amount = req.body.amount;
  const reference = req.get("Idempotency-Key");
  if (!mongoose.isValidObjectId(targetId)) return res.status(400).json({ error: "Invalid user id" });
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
    return res.status(400).json({ error: "Invalid top-up amount" });
  }
  if (typeof reference !== "string" || !/^[A-Za-z0-9._:-]{8,100}$/.test(reference)) {
    return res.status(400).json({ error: "A valid Idempotency-Key header is required" });
  }

  try {
    const target = await User.findOne({ _id: targetId, status: "active" }).select("_id username");
    if (!target) return res.status(404).json({ error: "User not found" });

    let agency = null;
    const isAdmin = ["admin", "owner"].includes(req.user.role);
    if (!isAdmin) {
      agency = await Agency.findOne({
        type: "shipping",
        status: "active",
        members: { $elemMatch: { userId: req.user._id, active: true } }
      }).select("_id name");
      if (!agency) return res.status(403).json({ error: "Active shipping-agency membership required" });
    }

    const result = await executeTransaction({
      userId: target._id,
      amount,
      type: "topup",
      direction: "credit",
      reference: "shipping:" + reference,
      metadata: {
        actorId: String(req.user._id),
        agencyId: agency ? String(agency._id) : null,
        agencyName: agency ? agency.name : null,
        action: "shipping_agency_topup"
      }
    });
    return res.json({ ...result, recipient: target.username });
  } catch (error) {
    if (error.message.includes("Idempotency key")) return res.status(409).json({ error: "Idempotency key conflict" });
    console.error("Shipping top-up failed:", error);
    return res.status(500).json({ error: "Unable to complete shipping top-up" });
  }
});

module.exports = router;
