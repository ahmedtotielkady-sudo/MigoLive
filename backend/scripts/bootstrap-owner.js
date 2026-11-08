require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");

async function bootstrapOwner() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  const username = String(process.env.OWNER_USERNAME || "").trim();
  if (!uri || !username) {
    throw new Error("Set MONGODB_URI (or MONGO_URI) and OWNER_USERNAME before running this script.");
  }

  await mongoose.connect(uri);
  try {
    const existingOwner = await User.exists({ role: "owner" });
    if (existingOwner) throw new Error("An owner account already exists. Bootstrap is disabled.");

    const user = await User.findOne({ username });
    if (!user) throw new Error("The selected account does not exist. Register it first, then retry.");

    user.role = "owner";
    await user.save();
    console.log(`Owner role granted to account: ${user.username}`);
  } finally {
    await mongoose.disconnect();
  }
}

bootstrapOwner().catch(error => {
  console.error("Owner bootstrap failed:", error.message);
  process.exitCode = 1;
});
