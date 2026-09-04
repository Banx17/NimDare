// Auth routes (Stage 3).
//
// Wallet-based auth endpoints mounted at /api/auth, plus the protected
// /api/me route.

import { Router } from "express";
import { connectHandler, verifyHandler } from "../controllers/authController";

const router = Router();

// POST /api/auth/connect — find/create a user by wallet address (no token).
router.post("/connect", connectHandler);

// POST /api/auth/verify — verify a wallet signature and return a JWT.
router.post("/verify", verifyHandler);

export default router;
