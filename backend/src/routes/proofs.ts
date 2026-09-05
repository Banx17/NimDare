// Proof routes (Stage 8).
//
// This single router is mounted at TWO prefixes in server.ts, so it serves:
//
//   app.use("/api/challenges", proofRoutes)   ->  /api/challenges/:challengeId/proofs
//     POST  (protected, creator, active only)     submit a proof
//     GET   (public)                              list proofs for a challenge
//
//   app.use("/api/proofs", proofRoutes)       ->  /api/proofs/:proofId/verify
//     POST  (protected, creator)                  approve/reject a proof
//
// (Each prefix only "sees" the routes that make sense under it. A stray call
// to the other shape would fail the ObjectId/segment checks early.)

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  submitProofHandler,
  listProofsHandler,
  verifyProofHandler,
} from "../controllers/proofs";

const router = Router();

// Public: list a challenge's proofs.
router.get("/:challengeId/proofs", listProofsHandler);

// Protected: submit a proof for your own active challenge.
router.post("/:challengeId/proofs", requireAuth, submitProofHandler);

// Protected: creator self-verifies one proof (approve/reject).
router.post("/:proofId/verify", requireAuth, verifyProofHandler);

export default router;