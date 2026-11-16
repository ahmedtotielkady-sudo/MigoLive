const crypto = require("crypto");
const express = require("express");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

function coturnIceServers(req) {
  const urls = String(process.env.TURN_URLS || "")
    .split(",").map(value => value.trim()).filter(Boolean);
  const secret = String(process.env.TURN_SHARED_SECRET || "");
  if (!urls.length || secret.length < 32) return null;

  const expiry = Math.floor(Date.now() / 1000) + 60 * 60;
  const username = expiry + ":" + String(req.auth.sub);
  const credential = crypto.createHmac("sha1", secret).update(username).digest("base64");
  return [{ urls: "stun:stun.l.google.com:19302" }, { urls, username, credential }];
}

async function turnixIceServers(req) {
  const token = String(process.env.TURNIX_API_TOKEN || "").trim();
  if (!token) return null;

  const clientId = String(req.auth.sub || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  const response = await fetch("https://turnix.io/api/v1/credentials/ice", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "X-TURN-CLIENT-IP": req.ip
    },
    body: JSON.stringify({ ttl: 3600, initiator_client: clientId }),
    signal: AbortSignal.timeout(10_000)
  });

  let payload = {};
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok || !Array.isArray(payload.iceServers) || !payload.iceServers.length) {
    const status = response.status;
    if (status === 401) {
      const error = new Error("TURN provider rejected the configured API token");
      error.status = 502;
      throw error;
    }
    if (status === 429) {
      const error = new Error("TURN provider usage limit reached");
      error.status = 503;
      throw error;
    }
    const error = new Error("TURN provider could not issue ICE credentials");
    error.status = 502;
    throw error;
  }
  return { iceServers: payload.iceServers, expiresAt: payload.expiresAt || null };
}

router.get("/", async (req, res) => {
  res.set("Cache-Control", "no-store");
  try {
    const turnix = await turnixIceServers(req);
    if (turnix) {
      return res.json({ ok: true, iceServers: turnix.iceServers, turnAvailable: true, expiresAt: turnix.expiresAt });
    }

    const coturn = coturnIceServers(req);
    if (coturn) {
      return res.json({ ok: true, iceServers: coturn, turnAvailable: true });
    }

    return res.json({
      ok: true,
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      turnAvailable: false
    });
  } catch (error) {
    const status = Number(error.status) || 503;
    console.error("TURN credential request failed:", error.message);
    return res.status(status).json({
      ok: false,
      message: status === 503 ? "خدمة ترحيل الصوت وصلت إلى حد الاستخدام" : "تعذر تجهيز اتصال الصوت"
    });
  }
});

module.exports = router;
