const crypto = require("crypto");
const express = require("express");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const iceServers = [{ urls: "stun:stun.l.google.com:19302" }];
  const urls = String(process.env.TURN_URLS || "")
    .split(",").map(value => value.trim()).filter(Boolean);
  const secret = String(process.env.TURN_SHARED_SECRET || "");

  // Coturn REST API credentials: username is expiry:user-id and the
  // credential is base64(HMAC-SHA1(shared-secret, username)).
  if (urls.length && secret.length >= 32) {
    const expiry = Math.floor(Date.now() / 1000) + 60 * 60;
    const username = expiry + ":" + String(req.auth.sub);
    const credential = crypto.createHmac("sha1", secret).update(username).digest("base64");
    iceServers.push({ urls, username, credential });
  }

  return res.set("Cache-Control", "no-store").json({
    ok: true,
    iceServers,
    turnAvailable: iceServers.length > 1
  });
});

module.exports = router;
