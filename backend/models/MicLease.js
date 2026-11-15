const mongoose = require("mongoose");

const micLeaseSchema = new mongoose.Schema({
  roomCode: { type: Number, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  socketId: { type: String, required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true, versionKey: false });

micLeaseSchema.index({ roomCode: 1, userId: 1 }, { unique: true });

module.exports = mongoose.models.MicLease || mongoose.model("MicLease", micLeaseSchema);
