// ⚠️  TEMPORARY VERIFICATION SCRIPT — NOT part of the application.
//     Proves the wallet auth pieces work end to end by exercising the
//     actual Nimiq primitives and the auth/JWT services:
//       1. Generate a real keypair + message + signature via @nimiq/core.
//       2. Valid signature + matching address  -> token issued.
//       3. Invalid signature                   -> clear error, no token.
//       4. Mismatched key/address pair         -> clear error.
//       5. JWT sign/verify roundtrip.
//       6. Delete the throwaway users created (no docs left behind).
//
//     Run it with:  npm run verify:auth
//     Remove this script once Stage 3 is confirmed to work.

import { connectDatabase } from "./config/database";
import mongoose from "mongoose";
import * as Nimiq from "@nimiq/core";
import { User } from "./models";
import { verifyAndLogin } from "./services/auth";
import { signToken, verifyToken } from "./utils/jwt";
import {
  verifyNimiqSignature,
  publicKeyMatchesAddress,
  hashNimiqMessage,
} from "./utils/verifySignature";

async function verify() {
  console.log("\n=== NimDare wallet-auth verification start ===\n");

  await connectDatabase();

  // --- 0. Build a real signature the way the mini-app provider would ---
  const keypair = Nimiq.KeyPair.generate();
  const publicKey = keypair.publicKey.toHex();
  const walletAddress = keypair.publicKey.toAddress().toUserFriendlyAddress();
  const message = "NimDare sign-in challenge (test aid, not app code)";

  const hash = hashNimiqMessage(message);
  const signature = keypair.sign(hash).toHex();

  console.log(`-> wallet address: ${walletAddress}`);
  console.log(`-> public key:     ${publicKey}`);
  console.log(`-> signature:      ${signature}`);

  // --- 1a. Low-level check: signature valid for key + message ---
  const sigOk = verifyNimiqSignature({ publicKey, signature, message });
  console.log(`\n[1a] Signature valid for pubkey + message: ${sigOk ? "PASS" : "FAIL"}`);

  // --- 1b. Low-level check: pubkey -> address matches claimed address ---
  const keyFits = publicKeyMatchesAddress(publicKey, walletAddress);
  console.log(`[1b] Public key matches claimed address:   ${keyFits ? "PASS" : "FAIL"}`);

  // --- 2. Valid flow -> token issued ---
  const created: string[] = [];
  const { token, user } = await verifyAndLogin({
    walletAddress,
    publicKey,
    message,
    signature,
  });
  created.push(user._id.toString());
  console.log(`\n[2] verifyAndLogin -> token issued:       ${token ? "PASS" : "FAIL"}`);
  console.log(`    token payload id matches user._id: ${token ? "PASS ✓ (see JWT roundtrip below)" : "FAIL"}`);

  // --- JWT sign/verify roundtrip (using the issued token) ---
  const decoded = verifyToken(token);
  const rtOk = !!decoded && decoded.id === user._id.toString() &&
    decoded.walletAddress === user.walletAddress;
  console.log(`[2b] JWT verify roundtrip (id + walletAddress): ${rtOk ? "PASS" : "FAIL"}`);

  // --- 3. Invalid signature -> error, no token ---
  let err3: Error | null = null;
  try {
    await verifyAndLogin({
      walletAddress,
      publicKey,
      message,
      signature: signature === "" ? "" : `${signature.slice(0, 2)}00${signature.slice(4)}`, // corrupt it
    });
  } catch (e) {
    err3 = e as Error;
  }
  console.log(`\n[3] Invalid signature -> clear error, no token: ${err3 ? "PASS" : "FAIL"}`);
  console.log(`    error message: ${err3?.message ?? "(no error thrown — FAIL)"}`);

  // --- 4. Mismatched key/address -> error ---
  const otherKeypair = Nimiq.KeyPair.generate();
  const otherAddress = otherKeypair.publicKey.toAddress().toUserFriendlyAddress();
  let err4: Error | null = null;
  try {
    await verifyAndLogin({
      walletAddress: otherAddress, // address belongs to a DIFFERENT key
      publicKey,
      message,
      signature,
    });
  } catch (e) {
    err4 = e as Error;
  }
  console.log(`[4] Mismatched key/address -> clear error:    ${err4 ? "PASS" : "FAIL"}`);
  console.log(`    error message: ${err4?.message ?? "(no error thrown — FAIL)"}`);

  // --- 5. JWT invalid/expired handling ---
  const badToken = verifyToken("not-a-real-token");
  const forged = signToken({ id: user._id.toString(), walletAddress });
  const forgedWrongSecret = verifyToken(`${forged.slice(0, -5)}xxxxx`);
  console.log(`\n[5] verifyToken(malformed) -> null: ${badToken === null ? "PASS" : "FAIL"}`);
  console.log(`    verifyToken(wrong sig) -> null:  ${forgedWrongSecret === null ? "PASS" : "FAIL"}`);

  // --- 6. Clean up created users ---
  await User.deleteMany({ _id: { $in: created } });
  const leftover = await User.countDocuments({ _id: { $in: created } });
  console.log(`\n[6] Throwaway users remaining: ${leftover}`);
  console.log(`    cleanup: ${leftover === 0 ? "PASS" : "FAIL"}`);

  await mongoose.disconnect();
  console.log("\n=== Wallet-auth verification COMPLETE. Disconnected. ===");
  process.exit(0);
}

verify().catch((err) => {
  console.error("\n❌  Verification FAILED:", err);
  process.exit(1);
});
