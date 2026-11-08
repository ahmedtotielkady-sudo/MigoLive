const router = require("express").Router();
const crypto = require("crypto");
const mongoose = require("mongoose");
const auth = require("../middleware/auth");
const User = require("../models/User");
const Agency = require("../models/Agency");

const ownerOnly = (req, res, next) => {
  if (req.user.role !== "owner") return res.status(403).json({ error: "Owner permission required" });
  next();
};
const agencyView = (agency) => ({
  id: agency._id, agencyId: agency.agencyId, name: agency.name,
  description: agency.description, status: agency.status,
  ownerId: agency.ownerId, memberCount: agency.members.length
});

// Anyone logged in can submit a creation request. It stays pending until the platform owner approves it.
router.post("/create-requests", auth, async (req, res, next) => {
  try {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();
    if (name.length < 3 || name.length > 60) return res.status(400).json({ error: "Agency name must be 3–60 characters" });
    if (description.length > 500) return res.status(400).json({ error: "Description is too long" });
    const user = await User.findById(req.user._id);
    if (user.agencyId) return res.status(409).json({ error: "You already belong to an agency" });
    const existing = await Agency.findOne({ ownerId: user._id, status: "pending" });
    if (existing) return res.status(409).json({ error: "You already have a pending agency request" });
    let agencyId;
    do { agencyId = crypto.randomBytes(4).toString("hex").toUpperCase(); }
    while (await Agency.exists({ agencyId }));
    const agency = await Agency.create({ agencyId, name, description, ownerId: user._id, status: "pending" });
    return res.status(201).json({ message: "Agency request sent to the platform owner", agency: agencyView(agency) });
  } catch (e) { next(e); }
});

// Only the platform owner can review new-agency requests.
router.get("/owner/create-requests", auth, ownerOnly, async (req, res, next) => {
  try {
    const requests = await Agency.find({ status: "pending" }).populate("ownerId", "username").sort({ createdAt: 1 });
    res.json({ requests: requests.map(a => ({ ...agencyView(a), applicant: a.ownerId?.username, createdAt: a.createdAt })) });
  } catch (e) { next(e); }
});
router.patch("/owner/create-requests/:agencyId", auth, ownerOnly, async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const decision = req.body.decision;
    if (!["approve", "reject"].includes(decision)) return res.status(400).json({ error: "Decision must be approve or reject" });
    let result;
    await session.withTransaction(async () => {
      const agency = await Agency.findOne({ agencyId: req.params.agencyId, status: "pending" }).session(session);
      if (!agency) { const error = new Error("Pending agency request not found"); error.status = 404; throw error; }
      if (decision === "approve") {
        const assigned = await User.updateOne(
          { _id: agency.ownerId, agencyId: null },
          { $set: { agencyId: agency._id, agencyRole: "agent" } },
          { session }
        );
        if (assigned.modifiedCount !== 1) { const error = new Error("Applicant already belongs to an agency"); error.status = 409; throw error; }
        agency.members.addToSet(agency.ownerId);
        agency.status = "active";
      } else {
        agency.status = "rejected";
      }
      agency.reviewedBy = req.user._id;
      agency.reviewedAt = new Date();
      await agency.save({ session });
      result = agency;
    });
    return res.json({ message: decision === "approve" ? "Agency approved and activated" : "Agency request rejected", agency: agencyView(result) });
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
  finally { await session.endSession(); }
});

// Agency lookup by its public ID.
router.get("/lookup/:agencyId", auth, async (req, res, next) => {
  try {
    const agency = await Agency.findOne({ agencyId: String(req.params.agencyId).trim().toUpperCase(), status: "active" }).populate("ownerId", "username");
    if (!agency) return res.status(404).json({ error: "Active agency not found" });
    res.json({ agency: { ...agencyView(agency), ownerUsername: agency.ownerId?.username } });
  } catch (e) { next(e); }
});

// Member requests are delivered to the selected agency's agent, not the platform owner.
router.post("/join-requests", auth, async (req, res, next) => {
  try {
    const agencyId = String(req.body.agencyId || "").trim().toUpperCase();
    const user = await User.findById(req.user._id);
    if (user.agencyId) return res.status(409).json({ error: "You already belong to an agency" });
    const agency = await Agency.findOne({ agencyId, status: "active" });
    if (!agency) return res.status(404).json({ error: "Active agency not found" });
    if (String(agency.ownerId) === String(user._id)) return res.status(400).json({ error: "You are already the agency owner" });
    if (agency.joinRequests.some(r => String(r.userId) === String(user._id) && r.status === "pending")) return res.status(409).json({ error: "A join request is already pending" });
    agency.joinRequests.push({ userId: user._id, username: user.username });
    await agency.save();
    res.status(201).json({ message: "Join request sent to the agency agent", agencyId: agency.agencyId });
  } catch (e) { next(e); }
});

router.get("/mine", auth, async (req, res, next) => {
  try {
    const agency = await Agency.findOne({ $or: [{ ownerId: req.user._id, status: "active" }, { members: req.user._id, status: "active" }] });
    if (!agency) return res.json({ agency: null });
    res.json({ agency: agencyView(agency), role: String(agency.ownerId) === String(req.user._id) ? "agent" : "member" });
  } catch (e) { next(e); }
});

const agentAgency = async (req, res, next) => {
  try {
    const agency = await Agency.findOne({ ownerId: req.user._id, status: "active" });
    if (!agency) return res.status(403).json({ error: "Active agency agent permission required" });
    req.agency = agency;
    next();
  } catch (e) { next(e); }
};
router.get("/join-requests", auth, agentAgency, (req, res) => {
  const requests = req.agency.joinRequests.filter(r => r.status === "pending");
  res.json({ requests });
});
router.patch("/join-requests/:requestId", auth, agentAgency, async (req, res, next) => {
  const session = await mongoose.startSession();
  try {
    const decision = req.body.decision;
    if (!["approve", "reject"].includes(decision)) return res.status(400).json({ error: "Decision must be approve or reject" });
    if (!mongoose.isValidObjectId(req.params.requestId)) return res.status(400).json({ error: "Invalid request ID" });
    let message = "Join request rejected";
    await session.withTransaction(async () => {
      const agency = await Agency.findOne({ _id: req.agency._id, ownerId: req.user._id, status: "active" }).session(session);
      if (!agency) { const error = new Error("Active agency not found"); error.status = 404; throw error; }
      const request = agency.joinRequests.id(req.params.requestId);
      if (!request || request.status !== "pending") { const error = new Error("Pending join request not found"); error.status = 404; throw error; }
      if (decision === "approve") {
        const updated = await User.updateOne(
          { _id: request.userId, agencyId: null },
          { $set: { agencyId: agency._id, agencyRole: "member" } },
          { session }
        );
        if (updated.modifiedCount !== 1) { const error = new Error("User already belongs to an agency"); error.status = 409; throw error; }
        agency.members.addToSet(request.userId);
        message = "Member accepted";
      }
      request.status = decision === "approve" ? "accepted" : "rejected";
      request.decidedAt = new Date();
      await agency.save({ session });
    });
    return res.json({ message });
  } catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
  finally { await session.endSession(); }
});
module.exports = router;
