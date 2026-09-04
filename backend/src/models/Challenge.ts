// Challenge model (Stage 2).
//
// Represents a solo challenge a user can create and commit NIM to.

import mongoose, { Schema, Types, InferSchemaType } from "mongoose";

// ----- TypeScript interface for a Challenge document -----
export interface IChallenge {
  title: string;
  description: string;
  creator: Types.ObjectId;
  // Only 'solo' is allowed for now; more types may be added later.
  type: "solo";
  rules: string;
  proofRequired: boolean;
  nimAmount: number;
  status: "draft" | "active" | "completed" | "failed";
  startDate: Date;
  endDate: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type ChallengeDoc = InferSchemaType<typeof challengeSchema>;

// ----- Mongoose schema -----
const challengeSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, required: true },
    creator: { type: Types.ObjectId, ref: "User", required: true },
    // Only 'solo' is supported in this stage. The enum keeps models honest.
    type: { type: String, enum: ["solo"], required: true },
    rules: { type: String, required: true },
    proofRequired: { type: Boolean, default: true },
    nimAmount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["draft", "active", "completed", "failed"],
      default: "draft",
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
  },
  { timestamps: true }
);

// ----- Model -----
export const Challenge = mongoose.model<IChallenge>(
  "Challenge",
  challengeSchema
);