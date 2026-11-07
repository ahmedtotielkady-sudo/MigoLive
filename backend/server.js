require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet({
  // The legacy single-file UI uses inline scripts/styles and trusted CDNs.
  // Keep the other Helmet protections while allowing its current asset model.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "blob:", "https:"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      connectSrc: ["'self'", "https:", "wss:"],
      mediaSrc: ["'self'", "data:", "blob:", "https:"],
      frameSrc: ["'self'", "blob:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"]
    }
  }
}));

const configuredOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = new Set([
  "capacitor://localhost",
  "http://localhost",
  "https://localhost",
  "http://localhost:3000",
  "http://localhost:8100",
  ...configuredOrigins
]);

app.use(cors({
  origin(origin, callback) {
    // Native clients and server-to-server requests commonly omit Origin.
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed"));
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
  maxAge: 600
}));

app.use(express.json({ limit: "32kb" }));

app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false
}));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/wallet", require("./routes/wallet"));
app.use("/api/games", require("./routes/games"));
app.use("/api/admin", require("./routes/admin"));

app.get("/api/config", (_req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json({
    paymentWallet: String(process.env.PAYMENT_WALLET_NUMBER || "").slice(0, 64)
  });
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "MigoLive API",
    database: mongoose.connection.readyState === 1 ? "connected" : "disconnected"
  });
});

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "..", "index.html")));
app.get("/api-config.js", (_req, res) => {
  res.type("application/javascript");
  return res.sendFile(path.join(__dirname, "..", "api-config.js"));
});

app.use((req, res) => res.status(404).json({ error: "Route not found" }));

app.use((error, _req, res, _next) => {
  if (error.message === "Origin not allowed") {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  console.error("Request failed:", error.message);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500 ? error.status : 500;
  return res.status(status).json({ error: status === 500 ? "Internal server error" : error.message });
});

const PORT = Number(process.env.PORT || 3000);
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function ensureDatabaseConnected() {
  if (!MONGO_URI) throw new Error("MONGODB_URI is missing");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters");
  }
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (mongoose.connection.readyState === 2) return mongoose.connection.asPromise();
  await mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000, maxPoolSize: 1 });
  console.log("MongoDB connected successfully");
  return mongoose.connection;
}

async function startServer() {
  await ensureDatabaseConnected();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`MigoLive API running on port ${PORT}`);
  });
}

app.ensureDatabaseConnected = ensureDatabaseConnected;

if (process.env.CLOUDFLARE_WORKERS !== "1" && require.main === module) {
  startServer().catch((error) => {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  });
}

module.exports = app;
