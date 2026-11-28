const mongoose = require("mongoose");

const roomPresenceSchema = new mongoose.Schema({
  roomCode: { type: Number, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  socketId: { type: String, required: true },
  uid: { type: Number, required: true },
  displayName: { type: String, default: "" },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }
}, { timestamps: true, versionKey: false });

roomPresenceSchema.index({ roomCode: 1, userId: 1, socketId: 1 }, { unique: true });
roomPresenceSchema.index({ roomCode: 1, expiresAt: 1 });

module.exports = mongoose.models.RoomPresence || mongoose.model("RoomPresence", roomPresenceSchema);
