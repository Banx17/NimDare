// Proof model (Stage 2).
//
// Represents proof a user submits for a challenge (e.g. a screenshot or text
// evidence that they completed the challenge).

import mongoose, { Schema, Types, InferSchemaType } from "mongoose";

// ----- TypeScript interface for a Proof document -----
export interface IProof {
  challenge: Types.ObjectId;
  user: Types.ObjectId;
  content: string;
  // String URLs for now — no file upload logic yet.
  images?: string[];
  status: "pending" | "approved" | "rejected";
  verifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ProofDoc = InferSchemaType<typeof proofSchema>;

// ----- Mongoose schema -----
const proofSchema = new Schema(
  {
    challenge: { type: Types.ObjectId, ref: "Challenge", required: true },
    user: { type: Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true },
    // Array of string URLs. Optional. No upload handling yet.
    images: { type: [String], required: false },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    verifiedAt: { type: Date, required: false },
  },
  { timestamps: true }
);

// ----- Model -----
export const Proof = mongoose.model<IProof>("Proof", proofSchema);