const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema({
  roomCode: { type: Number, required: true, unique: true, index: true },
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 50 },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  description: { type: String, default: "", maxlength: 240 },
  isPrivate: { type: Boolean, default: false },
  passwordHash: { type: String, default: "" },
  capacity: { type: Number, default: 25, min: 2, max: 25 },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  speakerSeats: [{
    seat: { type: Number, required: true, min: 1, max: 8 },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  }],
  status: { type: String, enum: ["open", "closed"], default: "open", index: true }
}, { timestamps: true, versionKey: false });

roomSchema.index({ status: 1, updatedAt: -1 });
module.exports = mongoose.models.Room || mongoose.model("Room", roomSchema);
