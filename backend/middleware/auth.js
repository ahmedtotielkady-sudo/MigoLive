const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const User = require("../models/User");

module.exports = async function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "migolive-api",
      audience: "migolive-app",
      algorithms: ["HS256"]
    });

    if (
      typeof decoded.sub !== "string" ||
      !mongoose.isValidObjectId(decoded.sub)
    ) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Always load authorization data from the database. Never trust a role
    // supplied by a client or an old token, and reject suspended/deleted users.
    const user = await User.findById(decoded.sub).select("_id username role status");

    if (!user || user.status !== "active") {
      return res.status(401).json({ error: "Account is unavailable" });
    }

    req.user = user;
    return next();
  } catch (_error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
