
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.set("trust proxy", 1);

// API protection
app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));

// Routes
const authRoutes = require("./routes/auth");
const walletRoutes = require("./routes/wallet");
const gamesRoutes = require("./routes/games");
const agencyRoutes = require("./routes/agencies");
const messageRoutes = require("./routes/messages");
app.use("/api/auth", authRoutes);
app.use("/api/wallet", walletRoutes);
app.use("/api/games", gamesRoutes);
app.use("/api/agencies", agencyRoutes);
app.use("/api/messages", messageRoutes);
// Health check
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "MigoLive API",
    database: mongoose.connection.readyState === 1
      ? "connected"
      : "disconnected"
  });
});

// Root
app.get("/", (req, res) => {
  res.send("MigoLive API is running");
});

// Database connection
const PORT = process.env.PORT || 3000;
const MONGO_URI =
  process.env.MONGODB_URI || process.env.MONGO_URI;

async function startServer() {
  try {
    if (!MONGO_URI) {
      throw new Error("MONGODB_URI is missing");
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is missing");
    }

    await mongoose.connect(MONGO_URI);

    console.log("MongoDB connected successfully");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`MigoLive API running on port ${PORT}`);
    });

  } catch (error) {
    console.error("Server startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
