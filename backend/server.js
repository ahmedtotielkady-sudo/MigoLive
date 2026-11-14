require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");

const app = express();
const port = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",").map((value) => value.trim()).filter(Boolean);

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed by CORS"));
  }
}));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    ok: connected,
    service: "MigoLive API",
    database: connected ? "connected" : "disconnected"
  });
});

app.use("/api/wallet", rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: true, legacyHeaders: false }), require("./routes/wallet"));

app.use("/api/wallet", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }), require("./routes/wallet"));

app.use("/api/auth", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: "محاولات كثيرة، حاول مرة أخرى بعد قليل" }
}), require("./routes/auth"));

app.use((error, _req, res, _next) => {
  if (error && error.message === "Origin is not allowed by CORS") {
    return res.status(403).json({ ok: false, message: "مصدر الطلب غير مسموح" });
  }
  console.error("API error:", error && error.message ? error.message : error);
  return res.status(500).json({ ok: false, message: "حدث خطأ بالخادم" });
});

async function start() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be configured with at least 32 characters");
  }
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  app.listen(port, "0.0.0.0", () => console.log(`MigoLive API listening on port ${port}`));
}
start().catch((error) => {
  console.error("Backend startup failed:", error.message);
  process.exit(1);
});
