require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

// Routes
app.use("/api/auth", require("./routes/auth"));
app.use("/api/wallet", require("./routes/wallet"));
app.use("/api/games", require("./routes/games"));
app.use("/api/agencies", require("./routes/agencies"));
app.use("/api/messages", require("./routes/messages"));
app.use("/api/app-update", require("./routes/appUpdates"));

// Readiness check: return 503 when MongoDB is unavailable.
app.get("/api/health", (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({
    ok: connected,
    service: "MigoLive API",
    database: connected ? "connected" : "disconnected"
  });
});

app.get("/", (req, res) => res.send("MigoLive API is running"));

// Consistent JSON response for unknown API routes.
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

// Central error handler; never expose stack traces or secrets to clients.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? error.status
    : 500;
  if (status >= 500) console.error("API error:", error);
  return res.status(status).json({
    error: status >= 500 ? "Internal server error" : error.message
  });
});

const PORT = Number(process.env.PORT) || 3000;
const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function startServer() {
  if (!MONGO_URI) throw new Error("MONGODB_URI is missing");
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }

  await mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 10000
  });
  console.log("MongoDB connected successfully");

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`MigoLive API running on port ${PORT}`);
  });

  const shutdown = async (signal) => {
    console.log(`${signal} received; shutting down`);
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((error) => {
  console.error("Server startup failed:", error.message);
  process.exit(1);
});

module.exports = app;
