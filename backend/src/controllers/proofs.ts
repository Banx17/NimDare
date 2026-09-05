// Proofs controller (Stage 8).
//
// Thin HTTP handlers for proof submission/listing/verification. Each handler:
//   - extracts + validates request data,
//   - calls the proofs service,
//   - maps service errors to the right HTTP status code.
//
// Route/auth wiring lives in src/routes/proofs.ts.

import type { Request, Response } from "express";
import { Types } from "mongoose";
import {
  submitProof,
  listProofsForChallenge,
  verifyProof,
} from "../services/proofs";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../services/challenges";

// Same mapping as the challenges controller: NotFound -> 404, Forbidden -> 403,
// Validation -> 400, anything unexpected -> 500.
function respondToServiceError(res: Response, err: unknown): void {
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: err.message });
  } else if (err instanceof ForbiddenError) {
    res.status(403).json({ error: err.message });
  } else if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message });
  } else {
    res.status(500).json({
      error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

// Validates an id route param is a well-formed MongoDB ObjectId, responding
// 400 (not a raw Mongoose cast error) otherwise.
function parseIdParam(res: Response, raw: unknown, label: string): string | null {
  if (typeof raw !== "string" || !Types.ObjectId.isValid(raw)) {
    res.status(400).json({ error: `Invalid ${label} id format.` });
    return null;
  }
  return raw;
}

// POST /api/challenges/:challengeId/proofs  (protected)
// Body: { content, images? }
export async function submitProofHandler(req: Request, res: Response) {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const challengeId = parseIdParam(res, req.params.challengeId, "challenge");
  if (challengeId === null) return;

  try {
    const proof = await submitProof(challengeId, userId, req.body);
    res.status(201).json({ proof });
  } catch (err) {
    respondToServiceError(res, err);
  }
}

// GET /api/challenges/:challengeId/proofs  (public)
export async function listProofsHandler(req: Request, res: Response) {
  const challengeId = parseIdParam(res, req.params.challengeId, "challenge");
  if (challengeId === null) return;

  try {
    const proofs = await listProofsForChallenge(challengeId);
    res.status(200).json({ proofs });
  } catch (err) {
    respondToServiceError(res, err);
  }
}

// POST /api/proofs/:proofId/verify  (protected)
// Body: { decision: 'approved' | 'rejected' }
export async function verifyProofHandler(req: Request, res: Response) {
  const requesterId = req.user?.id;
  if (!requesterId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const proofId = parseIdParam(res, req.params.proofId, "proof");
  if (proofId === null) return;

  const { decision } = req.body ?? {};
  // Validate up front so a bad decision is a clean 400; the service also
  // validates defensively (defense in depth).
  if (typeof decision !== "string" || (decision !== "approved" && decision !== "rejected")) {
    res
      .status(400)
      .json({ error: "Invalid decision. Allowed values: approved, rejected." });
    return;
  }

  try {
    const proof = await verifyProof(proofId, requesterId, decision);
    res.status(200).json({ proof });
  } catch (err) {
    respondToServiceError(res, err);
  }
}