require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const app = express();
app.disable("x-powered-by"); app.use(helmet());
const origins = (process.env.CORS_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
app.use(cors({ origin(origin, cb) { if (!origin || origins.includes(origin)) return cb(null, true); cb(new Error("Origin not allowed")); }, methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"] }));
app.use(express.json({ limit: "32kb" }));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 200, standardHeaders: true, legacyHeaders: false }));
app.get("/api/health", (_req,res) => res.json({ ok:true, service:"MigoLive API", database:mongoose.connection.readyState===1?"connected":"disconnected" }));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/wallet", require("./routes/wallet"));
app.use((err,_req,res,_next) => { if (err.message === "Origin not allowed") return res.status(403).json({error:"Origin not allowed"}); console.error(err); res.status(500).json({error:"Internal server error"}); });
async function start(){ if(!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required"); if(!process.env.JWT_SECRET || process.env.JWT_SECRET.length<32) throw new Error("JWT_SECRET must be at least 32 characters"); await mongoose.connect(process.env.MONGODB_URI); const port=Number(process.env.PORT||3000); app.listen(port,"0.0.0.0",()=>console.log("MigoLive API listening on "+port)); }
start().catch(e=>{console.error("Startup failed:",e.message);process.exit(1);});
