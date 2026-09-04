// Transaction model (Stage 2).
//
// Intentionally MINIMAL and GENERIC. The exact on-chain custody mechanism for
// committing NIM (HTLC vs. other approaches) is still being researched and is
// NOT finalized. To avoid baking in assumptions we can't undo, this model only
// captures generic, mechanism-agnostic fields.
//
// ⚠️  PROVISIONAL — this schema will likely gain fields (e.g. a contract
//     address, hash values, on-chain tx ids, target/user settlement parties)
//     once the NIM custody design is finalized. Do not build hard
//     dependencies on its current shape.

import mongoose, { Schema, Types, InferSchemaType } from "mongoose";

// ----- TypeScript interface for a Transaction document -----
export interface ITransaction {
  user: Types.ObjectId;
  challenge: Types.ObjectId;
  type: "commit" | "refund" | "reward";
  amount: number;
  status: "pending" | "confirmed" | "failed";
  // Free-text placeholder field for now — may hold notes about mechanism.
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type TransactionDoc = InferSchemaType<typeof transactionSchema>;

// ----- Mongoose schema -----
const transactionSchema = new Schema(
  {
    user: { type: Types.ObjectId, ref: "User", required: true },
    challenge: { type: Types.ObjectId, ref: "Challenge", required: true },
    type: {
      type: String,
      enum: ["commit", "refund", "reward"],
      required: true,
    },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "confirmed", "failed"],
      default: "pending",
    },
    // Optional free-text placeholder.
    notes: { type: String, required: false },
  },
  { timestamps: true }
);

// ----- Model -----
export const Transaction = mongoose.model<ITransaction>(
  "Transaction",
  transactionSchema
);