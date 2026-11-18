require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const requireAuth = require("./middleware/requireAuth");
const requireGameEnabled = require("./middleware/requireGameEnabled");
const http = require("http");
const { attachRealtime } = require("./realtime");

const app = express();
const httpServer = http.createServer(app);
const port = Number(process.env.PORT || 3000);
const allowedOrigins = (process.env.CORS_ORIGINS || "")
  .split(",").map((value) => value.trim()).filter(Boolean);

app.disable("x-powered-by");
// Railway terminates the public connection at one trusted proxy hop.
app.set("trust proxy", 1);
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

app.use("/api/gifts", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }), require("./routes/gifts"));

app.use("/api/wallet", require("./routes/wallet"));

// Owner-managed game policy is persisted in MongoDB. All game API requests pass
// through the policy gate before reaching individual game routers.
app.use("/api/game-control", rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: true, legacyHeaders: false }), require("./routes/game-control"));
app.use("/api/games", requireAuth, requireGameEnabled);

app.use("/api/games", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }), require("./routes/games"));
app.use("/api/games", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }), require("./routes/ocean-storm"));
app.use("/api/games", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }), require("./routes/cleopatra-gold"));
app.use("/api/games", rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }), require("./routes/rocket-crash"));

app.use("/api/rooms/ice-config", rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: true, legacyHeaders: false }), require("./routes/ice-config"));
app.use("/api/rooms/livekit", rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }), require("./routes/livekit"));

app.use("/api/rooms", rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }), require("./routes/rooms"));
app.use("/api/rooms", rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }), require("./routes/room-details"));

app.use("/api/users", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }), require("./routes/users"));

app.use("/api/messages", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }), require("./routes/messages"));

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
  const MicLease = require("./models/MicLease");
  const GameRound = require("./models/GameRound");
  const GameState = require("./models/GameState");
  await Promise.all([MicLease.init(), GameRound.init(), GameState.init()]);
  const io = attachRealtime(httpServer, allowedOrigins);
  app.set("io", io);
  httpServer.listen(port, "0.0.0.0", () => console.log(`MigoLive API + realtime listening on port ${port}`));
}
start().catch((error) => {
  console.error("Backend startup failed:", error.message);
  process.exit(1);
});
