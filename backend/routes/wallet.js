const router = require("express").Router();
const auth = require("../middleware/auth");
const Wallet = require("../models/Wallet");
const Ledger = require("../models/Ledger");

router.get("/", auth, async (req, res, next) => {
  try {
    // Ensure every authenticated account has one persistent wallet.
    const wallet = await Wallet.findOneAndUpdate(
      { userId: req.user._id },
      { $setOnInsert: { balance: 0 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    const entries = await Ledger.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({
      balance: wallet.balance,
      currency: "coins",
      transactions: entries
    });
  } catch (error) {
    return next(error);
  }
});

// No client endpoint can directly credit coins. Verified payment webhooks
// and authorized server-side workflows must credit the wallet.
module.exports = router;
