const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  body: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
  readAt: { type: Date, default: null }
}, { timestamps: true, versionKey: false });

messageSchema.index({ senderId: 1, recipientId: 1, createdAt: -1 });
messageSchema.index({ recipientId: 1, senderId: 1, createdAt: -1 });

module.exports = mongoose.model("Message", messageSchema);
