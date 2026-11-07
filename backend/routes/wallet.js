const router = require("express").Router();
const auth = require("../middleware/auth");
const Wallet = require("../models/Wallet");
const Ledger = require("../models/Ledger");
router.get("/", auth, async (req, res, next) => {
  try {
    const wallet = await Wallet.findOne({ userId: req.user._id }).lean();
    const entries = await Ledger.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ balance: wallet ? wallet.balance : 0, transactions: entries });
  } catch (e) { next(e); }
});
// No client endpoint can directly credit coins. Verified payment webhooks/admin workflows must do that server-side.
module.exports = router;
