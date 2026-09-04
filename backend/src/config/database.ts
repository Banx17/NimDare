// Database connection module (Stage 2).
//
// This module is responsible for ONE thing: connecting to MongoDB via
// Mongoose. It is kept separate from src/config/index.ts (which only holds
// the config *data* such as MONGO_URI). Keeping connection logic and config
// data in separate files keeps each module focused and testable.
//
// Behavior:
//  - On success: logs a clear message and resolves.
//  - On failure: logs a clear error and exits the process (process.exit(1))
//    so the app never silently runs without a database.

import mongoose from "mongoose";
import { config } from "./index";

const CONNECTION_TIMEOUT_MS = 10_000;

// Connects to MongoDB using the MONGO_URI from config.
// Called once from server.ts before the server starts listening.
export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: CONNECTION_TIMEOUT_MS,
    });
    console.log(
      `[database] Connected to MongoDB — ${mongoose.connection.name}@${mongoose.connection.host}`
    );
  } catch (err) {
    console.error(
      "\n❌  Failed to connect to MongoDB.\n" +
        "    Check that MONGO_URI in backend/.env is correct and that\n" +
        "    your MongoDB instance is running and reachable.\n"
    );
    console.error("[database] Error details:", err);
    // Exiting here is deliberate: the app is useless without a database, so
    // we fail loudly instead of letting it hang or run in a broken state.
    process.exit(1);
  }
}
