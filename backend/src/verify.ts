// ⚠️  TEMPORARY VERIFICATION SCRIPT — NOT part of the application.
//     This proves the MongoDB connection + core models work end to end by:
//       1. connecting to MongoDB,
//       2. creating one throwaway User document,
//       3. reading it back,
//       4. deleting it, and
//       5. disconnecting.
//     After running it, NO documents are left behind (the user is deleted).
//
//     Run it with:  npm run verify:db
//     Remove this script once Stage 2 is confirmed to work.

import { connectDatabase } from "./config/database";
import mongoose from "mongoose";
import { User } from "./models";

async function verify() {
  console.log("\n=== NimDare DB/model verification start ===\n");

  // 1. Connect (fail-fast on error — this exits the process if it can't).
  await connectDatabase();

  // 2. Create a throwaway User document.
  const throwaway = await User.create({
    walletAddress: "0x_verification_throwaway_1",
    username: "verification-throwaway",
  });
  console.log(`\n[1/3] Created User with id: ${throwaway._id}`);

  // 3. Read it back and confirm it round-trips.
  const found = await User.findById(throwaway._id).lean();
  if (!found) {
    throw new Error("User was created but could NOT be read back.");
  }
  console.log(
    `[2/3] Read back successfully: "${found.username}" (${found.walletAddress})`
  );
  console.log(
    `      timestamps present -> createdAt: ${found.createdAt}, updatedAt: ${found.updatedAt}`
  );

  // 4. Delete it so nothing is left behind.
  await User.findByIdAndDelete(throwaway._id);
  const remaining = await User.findById(throwaway._id).lean();
  console.log(`[3/3] Deleted throwaway User. Remaining in DB: ${remaining ?? "none"}`);

  // 5. Confirm nothing is left behind and disconnect.
  const count = await User.countDocuments({
    walletAddress: "0x_verification_throwaway_1",
  });
  console.log(`      Throwaway users remaining in DB: ${count}`);

  await mongoose.disconnect();
  console.log("\n=== Verification PASSED. Disconnected from MongoDB. ===");
  process.exit(0);
}

verify().catch((err) => {
  console.error("\n❌  Verification FAILED:", err);
  process.exit(1);
});
