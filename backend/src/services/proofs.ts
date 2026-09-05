// Proof service (Stage 8).
//
// Business logic for proof submission and self-verification, kept out of the
// controllers so handlers stay thin and the logic is easy to unit test.
//
// MVP SCOPE — self-verification only: for solo challenges there is a single
// participant (the creator), so "verification" means the creator submits
// evidence and then approves their own proof. There is NO independent witness
// or third-party check yet — this is a deliberate MVP limitation. Stronger
// verification is a later stage.
//
// Together with the completion gate in services/challenges.ts, submitting +
// approving a proof becomes a REQUIRED, recorded step before a challenge can
// be marked completed — closing the Stage 4 gap where the creator could flip
// active -> completed with no evidence at all.

import { Types, HydratedDocument } from "mongoose";
import { z } from "zod";
import { Proof, IProof } from "../models";
// Reuse the challenge service for shared rules (existence, ownership) and its
// error classes so every controller maps errors to HTTP codes the same way.
import {
  getChallengeById,
  isCreator,
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "./challenges";

// The actual shape of a Proof document as returned by Mongoose queries.
export type ProofDocument = HydratedDocument<IProof>;

// ---------------------------------------------------------------------------
// Input validation (submit body)
// ---------------------------------------------------------------------------
// `content` is the free-text evidence. `images` stays a plain array of string
// URLs (e.g. https://...) — there is deliberately NO file/upload handling in
// this stage.
const submitProofSchema = z.object({
  content: z.string().min(1, "content is required."),
  images: z.array(z.string()).optional(),
});

export type SubmitProofInput = z.infer<typeof submitProofSchema>;

function validationMessage(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join("; ");
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

// Creates a pending Proof for `challengeId` on behalf of `userId`.
//
// Rules:
//   - The challenge must exist (else NotFoundError).
//   - Only the challenge's creator may submit (else ForbiddenError) — solo
//     challenges have exactly one participant, its creator.
//   - The challenge must be 'active' (else ValidationError) — you can't submit
//     evidence for a draft or an already decided challenge.
export async function submitProof(
  challengeId: string,
  userId: string,
  data: unknown
): Promise<ProofDocument> {
  // 1. Validate the body first (cheap, doesn't depend on auth/db state).
  const parsed = submitProofSchema.safeParse(data ?? {});
  if (!parsed.success) {
    throw new ValidationError(validationMessage(parsed.error));
  }
  const { content, images } = parsed.data;

  // 2. Challenge must exist.
  const challenge = await getChallengeById(challengeId);

  // 3. Creator-only (solo challenges have a single participant).
  if (!isCreator(challenge, userId)) {
    throw new ForbiddenError(
      "Only the creator of the challenge can submit proof."
    );
  }

  // 4. Challenge must be active.
  if (challenge.status !== "active") {
    throw new ValidationError(
      `Proofs can only be submitted for 'active' challenges, this one is '${challenge.status}'.`
    );
  }

  // 5. Create the pending proof.
  const proof = await Proof.create({
    challenge: new Types.ObjectId(challengeId),
    user: new Types.ObjectId(userId),
    content,
    // images is optional — only include it when actually provided
    // (exactOptionalPropertyTypes is strict about undefined values).
    ...(images !== undefined ? { images } : {}),
  });
  return proof as ProofDocument;
}

// Returns every proof for a challenge, newest first.
// The challenge must exist first (a bogus id is a 404, not an empty list, so
// the caller knows the URL/route was wrong rather than "no proofs yet").
export async function listProofsForChallenge(
  challengeId: string
): Promise<ProofDocument[]> {
  await getChallengeById(challengeId); // 404 if the challenge doesn't exist
  const proofs = await Proof.find({
    challenge: new Types.ObjectId(challengeId),
  }).sort({ createdAt: -1 }); // newest first
  return proofs as ProofDocument[];
}

// Verifies a single proof: sets its status to 'approved' | 'rejected' and
// records when that happened.
//
// Rules:
//   - The proof must exist (else NotFoundError).
//   - `decision` must be 'approved' or 'rejected' (else ValidationError).
//   - Only the CHALLENGE's creator may verify its proofs (else ForbiddenError)
//     — self-verification for the solo MVP.
//   - A proof that is no longer 'pending' cannot be re-verified (else
//     ValidationError) — the record of an approval/rejection is final.
export async function verifyProof(
  proofId: string,
  requesterId: string,
  decision: string
): Promise<ProofDocument> {
  // 1. Validate the decision.
  if (decision !== "approved" && decision !== "rejected") {
    throw new ValidationError(
      "Invalid decision. Allowed values: approved, rejected."
    );
  }

  // 2. Proof must exist.
  const proof = await Proof.findById(proofId);
  if (!proof) {
    throw new NotFoundError("Proof not found.");
  }

  // 3. Only the challenge's creator may verify its proofs.
  const challenge = await getChallengeById(proof.challenge.toString());
  if (!isCreator(challenge, requesterId)) {
    throw new ForbiddenError(
      "Only the creator of the challenge can verify its proofs."
    );
  }

  // 4. No re-verification.
  if (proof.status !== "pending") {
    throw new ValidationError(
      `This proof has already been verified (${proof.status}). A proof can only be verified once.`
    );
  }

  // 5. Record the decision.
  proof.status = decision;
  proof.verifiedAt = new Date();
  await proof.save();
  return proof as ProofDocument;
}