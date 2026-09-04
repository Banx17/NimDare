// Auth controller (Stage 3).
//
// Thin HTTP handlers for wallet-based auth:
//   - POST /api/auth/connect  -> find or create a user by wallet address
//   - POST /api/auth/verify   -> verify a wallet signature + issue a JWT
//   - GET  /api/me            -> (protected) return the current user fresh
//                                from MongoDB, not just the JWT payload

import type { Request, Response } from "express";
import { connectWallet, verifyAndLogin } from "../services/auth";
import { User } from "../models";

// POST /api/auth/connect
// Body: { walletAddress }
// Finds the user by wallet address or creates a new one. Returns the user
// (no token here — the token comes from /api/auth/verify).
export async function connectHandler(req: Request, res: Response) {
  const { walletAddress } = req.body ?? {};

  if (typeof walletAddress !== "string" || walletAddress.trim() === "") {
    res.status(400).json({ error: "walletAddress is required." });
    return;
  }

  try {
    const user = await connectWallet(walletAddress);
    res.status(200).json({ user });
  } catch (err) {
    res.status(500).json({
      error: `Failed to connect wallet: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
  }
}

// POST /api/auth/verify
// Body: { walletAddress, publicKey, message, signature }
// Verifies the signature matches the public key + address, then issues a JWT.
export async function verifyHandler(req: Request, res: Response) {
  const { walletAddress, publicKey, message, signature } = req.body ?? {};

  if (
    typeof walletAddress !== "string" ||
    typeof publicKey !== "string" ||
    typeof message !== "string" ||
    typeof signature !== "string"
  ) {
    res.status(400).json({
      error: "walletAddress, publicKey, message and signature are all required.",
    });
    return;
  }

  try {
    const { token, user } = await verifyAndLogin({
      walletAddress,
      publicKey,
      message,
      signature,
    });
    res.status(200).json({ token, user });
  } catch (err) {
    // Signature/key/address verification failures.
    res
      .status(401)
      .json({ error: err instanceof Error ? err.message : String(err) });
  }
}

// GET /api/me  (protected by requireAuth)
// Returns the current user fetched fresh from MongoDB (by the id in the JWT),
// so the response reflects the latest DB state rather than the token snapshot.
export async function meHandler(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const user = await User.findById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found." });
    return;
  }

  res.status(200).json({ user });
}
