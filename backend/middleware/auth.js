const jwt = require("jsonwebtoken");
const User = require("../models/User");

module.exports = async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET, {
      issuer: "migolive-api",
      audience: "migolive-app"
    });

    const user = await User.findById(decoded.sub).select("username role status");
    if (!user || user.status !== "active") {
      return res.status(401).json({ error: "Invalid or inactive account" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};
