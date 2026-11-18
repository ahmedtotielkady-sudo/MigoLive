const mongoose = require("mongoose");

const legacyMigrationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  migrationId: { type: String, required: true, minlength: 16, maxlength: 80 },
  status: { type: String, enum: ["completed"], default: "completed" },
  imported: {
    profile: { type: Boolean, default: false }
  },
  ignoredFields: { type: [String], default: [] }
}, { timestamps: true, versionKey: false });

legacyMigrationSchema.index({ userId: 1, migrationId: 1 }, { unique: true });
module.exports = mongoose.models.LegacyMigration || mongoose.model("LegacyMigration", legacyMigrationSchema);
