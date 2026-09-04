// Challenge service (Stage 4).
//
// Business logic for Challenge CRUD. Kept out of the controllers so handlers
// stay thin and the logic is easy to unit test.
//
// Only SOLO challenges are supported in the MVP — a challenge has exactly one
// participant, its creator. There is deliberately NO join/participant logic.
//
// NOTE: proof submission and verification are a LATER stage (Stage 9). Here
// "complete"/"fail" are simple status transitions the creator makes directly,
// NOT verified outcomes.

import { Types, HydratedDocument } from "mongoose";
import { z } from "zod";
import { Challenge, IChallenge } from "../models";

// The actual shape of a Challenge document as returned by Mongoose queries
// (has methods like .save(), .toJSON(), etc.). Using this type (instead of the
// plain IChallenge interface) means callers get the real document API.
export type ChallengeDocument = HydratedDocument<IChallenge>;

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------
// Rather than returning error strings, the service throws these distinct error
// classes. The controller catches them and maps each class to the right HTTP
// status code.

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class ValidationError extends Error {}

// ---------------------------------------------------------------------------
// Input validation (create body)
// ---------------------------------------------------------------------------
// We use `zod` for request validation: it gives us a declarative schema, clear
// error messages, and (via z.infer) a fully-typed output object we can trust in
// the rest of the service. This is a small, widely-used dependency that will
// also serve later stages (proofs, transactions, etc.).
//
// The schema enforces:
//   - required fields: title, description, rules, nimAmount, startDate, endDate
//   - nimAmount is a positive number
//   - endDate is strictly after startDate
//   - type is optional on input — we FORCE it to 'solo' regardless (see below)
const createChallengeSchema = z
  .object({
    title: z.string().min(1, "title is required."),
    description: z.string().min(1, "description is required."),
    rules: z.string().min(1, "rules is required."),
    proofRequired: z.boolean().optional(),
    nimAmount: z
      .number({ error: "nimAmount must be a number." })
      .positive("nimAmount must be a positive number."),
    startDate: z.coerce.date({ error: "startDate must be a valid date." }),
    endDate: z.coerce.date({ error: "endDate must be a valid date." }),
  })
  .refine((d) => d.endDate > d.startDate, {
    message: "endDate must be after startDate.",
    path: ["endDate"],
  });

export type CreateChallengeInput = z.infer<typeof createChallengeSchema>;

// Small helper that turns a zod error into a readable single-line message.
function validationMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

// The statuses a challenge can be in, and the only transitions the creator may
// perform in this stage. "complete"/"fail" are direct transitions — no proof
// verification (Stage 9).
const ALLOWED_TRANSITIONS: Record<IChallenge["status"], IChallenge["status"][]> = {
  draft: ["active"], // draft -> active
  active: ["completed", "failed"], // active -> completed | failed
  completed: [], // no outgoing transitions
  failed: [], // no outgoing transitions
};

// ---------------------------------------------------------------------------
// Ownership helper
// ---------------------------------------------------------------------------
// Reusable check so we don't repeat "is this user the creator?" in every
// handler. An `ownerId` is a user id string from the JWT (`req.user.id`).
function isCreator(challenge: IChallenge, ownerId: string): boolean {
  return challenge.creator.toString() === ownerId;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// Validates + forces `type: 'solo'`, then creates and returns the challenge.
// The creator is always the authenticated user (their Mongo `_id`).
export async function createChallenge(
  creatorId: string,
  data: unknown
): Promise<ChallengeDocument> {
  // 1. Only 'solo' is supported. If the client explicitly passed a non-solo
  //    type, reject it up front with a clear message (we'd throw for it anyway,
  //    but this gives a friendlier error before zod gets to it).
  if (
    data &&
    typeof data === "object" &&
    "type" in data &&
    (data as { type?: unknown }).type !== "solo"
  ) {
    throw new ValidationError(
      "Only 'solo' challenges are supported right now. type must be 'solo'."
    );
  }

  // 2. Validate the rest of the input with zod.
  const parsed = createChallengeSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new ValidationError(validationMessage(parsed.error));
  }
  const { proofRequired, ...rest } = parsed.data;

  // 3. Build the create object. proofRequired is optional, so we only include
  //    it when the client actually provided it (exactOptionalPropertyTypes is
  //    strict about never setting a key to undefined).
  const createData: Record<string, unknown> = {
    ...rest,
    type: "solo", // forced
    status: "draft", // default
    creator: new Types.ObjectId(creatorId),
  };
  if (proofRequired !== undefined) {
    createData.proofRequired = proofRequired;
  }

  const challenge = await Challenge.create(createData);
  return challenge as ChallengeDocument;
}

// Lists challenges, optionally filtered by status and/or creator, with simple
// pagination (page, limit). `filters` values are already validated strings.
export interface ChallengeListFilters {
  status?: IChallenge["status"];
  creator?: string;
  page?: number;
  limit?: number;
}

export async function listChallenges(filters: ChallengeListFilters = {}) {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(100, Math.max(1, filters.limit ?? 20));

  const query: { status?: IChallenge["status"]; creator?: Types.ObjectId } = {};
  if (filters.status) query.status = filters.status;
  if (filters.creator) query.creator = new Types.ObjectId(filters.creator);

  const [challenges, total] = await Promise.all([
    Challenge.find(query)
      .sort({ createdAt: -1 }) // newest first
      .skip((page - 1) * limit)
      .limit(limit),
    Challenge.countDocuments(query),
  ]);

  return {
    challenges,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 0,
  };
}

// Returns one challenge by id. Throws NotFoundError if it doesn't exist.
export async function getChallengeById(id: string): Promise<ChallengeDocument> {
  const challenge = await Challenge.findById(id);
  if (!challenge) {
    throw new NotFoundError("Challenge not found.");
  }
  return challenge as ChallengeDocument;
}

// Updates a challenge's status. Returns the updated challenge.
//
// Rules:
//   - Only the creator may change status (else ForbiddenError).
//   - The new status must be a real status value (else ValidationError).
//   - The transition must be allowed from the current status (else ValidationError).
export async function updateChallengeStatus(
  id: string,
  requesterId: string,
  newStatus: string
): Promise<ChallengeDocument> {
  const challenge = await getChallengeById(id);

  if (!isCreator(challenge, requesterId)) {
    throw new ForbiddenError("Only the creator can change a challenge's status.");
  }

  if (
    typeof newStatus !== "string" ||
    !(newStatus === "draft" || newStatus === "active" || newStatus === "completed" || newStatus === "failed")
  ) {
    throw new ValidationError(
      "Invalid status. Allowed values: draft, active, completed, failed."
    );
  }

  const allowed = ALLOWED_TRANSITIONS[challenge.status];
  // TS note: newStatus is now narrowed to the status union by the check above.
  if (!allowed.includes(newStatus as IChallenge["status"])) {
    throw new ValidationError(
      `Cannot move a challenge from '${challenge.status}' to '${newStatus}'. ` +
        `Allowed next statuses: ${allowed.length ? allowed.join(", ") : "none"}.`
    );
  }

  challenge.status = newStatus as IChallenge["status"];
  await challenge.save();
  return challenge as ChallengeDocument;
}

// Deletes a challenge. Returns nothing on success.
//
// Rules:
//   - Only the creator may delete (else ForbiddenError).
//   - Only a DRAFT challenge may be deleted. An active/completed challenge has
//     (eventually) NIM committed to it, so we disallow deleting it outright in
//     this stage. (Actual NIM movement is a later stage — this constraint is a
//     deliberate safety guard for the model.)
export async function deleteChallenge(id: string, requesterId: string): Promise<void> {
  const challenge = await getChallengeById(id);

  if (!isCreator(challenge, requesterId)) {
    throw new ForbiddenError("Only the creator can delete a challenge.");
  }

  if (challenge.status !== "draft") {
    throw new ValidationError(
      "Only 'draft' challenges can be deleted. Active/completed challenges cannot be removed."
    );
  }

  await Challenge.findByIdAndDelete(challenge._id);
}
