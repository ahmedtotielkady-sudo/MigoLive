const router = require("express").Router();
const auth = require("../middleware/auth");
const Wallet = require("../models/Wallet");
const Ledger = require("../models/Ledger");
const { executeGiftTransfer } = require("../services/walletService");
const { requestTopup } = require("../services/topupService");

router.use(auth);

router.get("/", async (req, res, next) => {
  try {
    const [wallet, entries, pendingTopups] = await Promise.all([
      Wallet.findOne({ userId: req.user._id }).select("balance updatedAt").lean(),
      Ledger.find({ userId: req.user._id, status: "posted" })
        .sort({ createdAt: -1, _id: -1 })
        .limit(50)
        .select("type amount direction reference metadata createdAt")
        .lean(),
      Ledger.find({ userId: req.user._id, type: "topup_pending", status: "pending" })
        .sort({ createdAt: -1 })
        .limit(20)
        .select("amount reference metadata createdAt")
        .lean()
    ]);

    return res.json({
      balance: wallet ? wallet.balance : 0,
      updatedAt: wallet?.updatedAt || null,
      transactions: entries,
      pendingTopups
    });
  } catch (error) {
    return next(error);
  }
});

// Create a pending top-up request. The balance is not credited until an
// authorized administrator verifies the payment outside the client app.
router.post("/topups", async (req, res) => {
  const amount = req.body.amount;
  const paymentReference = String(req.body.paymentReference || "").trim();
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
    return res.status(400).json({ error: "Invalid top-up amount" });
  }
  if (paymentReference.length > 100) {
    return res.status(400).json({ error: "Payment reference is too long" });
  }
  try {
    const result = await requestTopup({ userId: req.user._id, amount, paymentReference });
    return res.status(201).json(result);
  } catch (error) {
    console.error("Top-up request failed:", error);
    return res.status(500).json({ error: "Unable to create top-up request" });
  }
});

// Transfer virtual coins to another active account. The client cannot credit
// either wallet directly; both balance changes and ledger rows commit together.
router.post("/gift", async (req, res) => {
  const recipientUsername = String(req.body.recipientUsername || "").trim();
  const recipientLegacyUid = String(req.body.recipientLegacyUid || "").trim();
  const amount = req.body.amount;
  const reference = req.get("Idempotency-Key");

  if (recipientLegacyUid ? !/^\d{5,10}$/.test(recipientLegacyUid) : !/^[A-Za-z0-9_]{3,24}$/.test(recipientUsername)) {
    return res.status(400).json({ error: "Invalid recipient username or ID" });
  }
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 1000000) {
    return res.status(400).json({ error: "Gift amount must be a positive integer up to 1,000,000" });
  }
  if (typeof reference !== "string" || !/^[A-Za-z0-9._:-]{8,100}$/.test(reference)) {
    return res.status(400).json({ error: "A valid Idempotency-Key header is required" });
  }

  try {
    const result = await executeGiftTransfer({
      senderId: req.user._id,
      recipientUsername,
      recipientLegacyUid,
      amount,
      reference
    });
    return res.json(result);
  } catch (error) {
    if (error.message === "Insufficient balance") {
      return res.status(409).json({ error: "Insufficient balance" });
    }
    if (error.message === "Recipient not found") {
      return res.status(404).json({ error: "Recipient not found" });
    }
    if (error.message === "Cannot gift yourself") {
      return res.status(400).json({ error: error.message });
    }
    if (error.message.includes("Idempotency key")) {
      return res.status(409).json({ error: "Idempotency key conflict" });
    }
    console.error("Gift transfer failed:", error);
    return res.status(500).json({ error: "Unable to process gift transfer" });
  }
});

module.exports = router;
