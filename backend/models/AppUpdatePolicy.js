const mongoose = require("mongoose");

const appUpdatePolicySchema = new mongoose.Schema({
  _id: { type: String, default: "global" },
  enabled: { type: Boolean, default: false },
  latestVersionCode: { type: Number, default: 1, min: 1 },
  minimumVersionCode: { type: Number, default: 1, min: 1 },
  apkUrl: { type: String, default: "" },
  contactMessage: { type: String, default: "هذا الإصدار لم يعد مدعومًا. يُرجى التواصل مع مالك التطبيق للحصول على أحدث إصدار من ميجو لايف." },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  updatedAt: { type: Date, default: Date.now }
}, { versionKey: false });

module.exports = mongoose.models.AppUpdatePolicy || mongoose.model("AppUpdatePolicy", appUpdatePolicySchema);
