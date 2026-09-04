// User model (Stage 2).
//
// Represents a current User / Profile / Developer user of NimDare.
//
// Note on typing convention: we colocate the TypeScript interface (IUser)
// with its Mongoose schema/model in this same file. This is the standard
// Mongoose + TypeScript pattern — keeping the interface next to the schema
// that implements it means the two can never drift apart.

import mongoose, { Schema, InferSchemaType } from "mongoose";

// ----- TypeScript interface for a User document -----
export interface IUser {
  walletAddress: string;
  username: string;
  profileImage?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Helper type for the raw document shape (used for lean queries etc.).
export type UserDoc = InferSchemaType<typeof userSchema>;

// ----- Mongoose schema -----
// timestamps: true tells Mongoose to manage createdAt / updatedAt for us, so
// we do NOT define them by hand — Mongoose adds and populates both fields.
const userSchema = new Schema(
  {
    walletAddress: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    // Optional — a string URL for now. No upload logic yet.
    profileImage: { type: String, required: false },
  },
  { timestamps: true }
);

// ----- Model -----
export const User = mongoose.model<IUser>("User", userSchema);
