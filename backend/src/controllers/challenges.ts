// Challenges controller (Stage 4).
//
// Thin HTTP handlers for Challenge CRUD. Each handler:
//   - extracts + validates request data,
//   - calls the challenges service,
//   - maps service errors to the right HTTP status code.
//
// Route/auth wiring lives in src/routes/challenges.ts.

import type { Request, Response } from "express";
import { Types } from "mongoose";
import {
  createChallenge,
  listChallenges,
  getChallengeById,
  updateChallengeStatus,
  deleteChallenge,
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../services/challenges";
import type { IChallenge } from "../models";

// Convenience: converts a service-thrown error into an appropriate HTTP
// response. Returns true when it has sent a response (caller should stop).
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

// Returns the id from req.params only if it's a valid MongoDB ObjectId.
// Responds 400 (not a raw Mongoose cast error / server crash) otherwise.
function parseIdParam(res: Response, raw: unknown): string | null {
  if (typeof raw !== "string" || !Types.ObjectId.isValid(raw)) {
    res.status(400).json({ error: "Invalid challenge id format." });
    return null;
  }
  return raw;
}

// POST /api/challenges  (protected)
// Body: { title, description, rules, nimAmount, startDate, endDate,
//         proofRequired? }  — type is forced to 'solo'.
export async function createChallengeHandler(req: Request, res: Response) {
  const creatorId = req.user?.id;
  if (!creatorId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  try {
    const challenge = await createChallenge(creatorId, req.body);
    res.status(201).json({ challenge });
  } catch (err) {
    respondToServiceError(res, err);
  }
}

// GET /api/challenges  (public)
// Query: ?status=active&creator=<id>&page=1&limit=20
export async function listChallengesHandler(req: Request, res: Response) {
  const { status, creator } = req.query;

  // Validate the optional status filter so a bad value becomes a clean 400.
  const allowed = ["draft", "active", "completed", "failed"];
  if (status !== undefined && (typeof status !== "string" || !allowed.includes(status))) {
    res.status(400).json({ error: "Invalid status filter. Allowed: draft, active, completed, failed." });
    return;
  }

  // Validate the optional creator filter is a valid ObjectId.
  if (creator !== undefined && (typeof creator !== "string" || !Types.ObjectId.isValid(creator))) {
    res.status(400).json({ error: "Invalid creator id filter." });
    return;
  }

  const page = Number(req.query.page) || 1;
  const limit = Number(req.query.limit) || 20;

  try {
    // Build filters only for the fields the client actually provided
    // (exactOptionalPropertyTypes rejects keys that carry undefined).
    const filters: {
      status?: IChallenge["status"];
      creator?: string;
      page?: number;
      limit?: number;
    } = {};
    if (typeof status === "string") filters.status = status as IChallenge["status"];
    if (typeof creator === "string") filters.creator = creator;
    if (Number.isFinite(page)) filters.page = page;
    if (Number.isFinite(limit)) filters.limit = limit;

    const result = await listChallenges(filters);
    res.status(200).json(result);
  } catch (err) {
    respondToServiceError(res, err);
  }
}

// GET /api/challenges/:id  (public)
export async function getChallengeHandler(req: Request, res: Response) {
  const id = parseIdParam(res, req.params.id);
  if (id === null) return;

  try {
    const challenge = await getChallengeById(id);
    res.status(200).json({ challenge });
  } catch (err) {
    respondToServiceError(res, err);
  }
}

// PATCH /api/challenges/:id/status  (protected — creator only)
// Body: { status }
export async function updateStatusHandler(req: Request, res: Response) {
  const requesterId = req.user?.id;
  if (!requesterId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const id = parseIdParam(res, req.params.id);
  if (id === null) return;

  const { status } = req.body ?? {};
  if (typeof status !== "string" || status === "") {
    res.status(400).json({ error: "A 'status' value is required." });
    return;
  }

  try {
    const challenge = await updateChallengeStatus(id, requesterId, status);
    res.status(200).json({ challenge });
  } catch (err) {
    respondToServiceError(res, err);
  }
}

// DELETE /api/challenges/:id  (protected — creator, draft only)
export async function deleteChallengeHandler(req: Request, res: Response) {
  const requesterId = req.user?.id;
  if (!requesterId) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const id = parseIdParam(res, req.params.id);
  if (id === null) return;

  try {
    await deleteChallenge(id, requesterId);
    res.status(204).end();
  } catch (err) {
    respondToServiceError(res, err);
  }
}
