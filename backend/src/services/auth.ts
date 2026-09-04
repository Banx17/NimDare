// Auth service (Stage 3).
//
// Business logic for wallet-based auth, kept out of the controllers so the
// route handlers stay thin and the logic is easy to unit test.

import { User } from "../models";
import { signToken, TokenPayload } from "../utils/jwt";
import {
  verifyNimiqSignature,
  publicKeyMatchesAddress,
} from "../utils/verifySignature";

export interface LoginInput {
  walletAddress: string;
  publicKey: string; // hex string
  message: string;
  signature: string; // hex string
}

// Finds the User with the given walletAddress, or creates one if it doesn't
// exist yet. Returns the user document.
export async function connectWallet(walletAddress: string) {
  const address = walletAddress.trim();
  let user = await User.findOne({ walletAddress: address });

  if (!user) {
    // New user — username is derived from the wallet address for now.
    // (Profile setup / naming is a later stage.)
    user = await User.create({ walletAddress: address, username: address });
  }

  return user;
}

// Verifies a wallet signature and, if valid, issues a JWT.
//
// Steps:
//   1. Check the signature is genuine for the given publicKey + message.
//   2. Check the publicKey corresponds to the claimed walletAddress.
//   3. Find or create the user and issue a JWT.
//
// Throws a clear, specific Error if either check fails — the caller decides
// how to surface that (e.g. an HTTP 401).
export async function verifyAndLogin(input: LoginInput) {
  const { walletAddress, publicKey, message, signature } = input;

  // Step 1 — is the signature valid for this key + message?
  let signatureValid = false;
  try {
    signatureValid = verifyNimiqSignature({ publicKey, signature, message });
  } catch (err) {
    throw new Error(
      `Invalid signature data: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!signatureValid) {
    throw new Error(
      "Signature verification failed: the signature was not valid for the " +
        "provided public key and message."
    );
  }

  // Step 2 — does this public key actually belong to the claimed wallet?
  let keyMatchesAddress = false;
  try {
    keyMatchesAddress = publicKeyMatchesAddress(publicKey, walletAddress);
  } catch (err) {
    throw new Error(
      `Invalid public key / address: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  if (!keyMatchesAddress) {
    throw new Error(
      "Signature key mismatch: the provided public key does not correspond " +
        "to the claimed wallet address."
    );
  }

  // Step 3 — find or create the user, then sign a token.
  const user = await connectWallet(walletAddress);
  const payload: TokenPayload = {
    id: user._id.toString(),
    walletAddress: user.walletAddress,
  };
  const token = signToken(payload);

  return { token, user };
}
