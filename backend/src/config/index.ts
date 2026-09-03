// Backend environment configuration.
//
// This module runs FIRST when the server starts. It loads .env (via dotenv),
// reads every environment variable the app needs, and exports a single typed
// config object that the rest of the app imports. If anything required is
// missing, the server crashes immediately with a clear message — this is
// called "failing fast" and it prevents the app from running in a broken state.

import dotenv from "dotenv";

// Load .env variables into process.env as early as possible.
dotenv.config();

// ----- helpers -----

// Calls process.exit(1) with a clear message if the variable is missing.
// Currently unused — will be needed in Stage 2 (MONGO_URI) and later.
function required(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === "") {
    console.error(
      `\n❌  Missing required environment variable: ${key}\n` +
        `    Add it to backend/.env (see backend/.env.example for the template).`
    );
    process.exit(1);
  }
  return value;
}

// Returns the variable's value, or `fallback` if it's not set.
function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

// ----- config -----

export const config = {
  port: Number(optional("PORT", "3001")),
  nodeEnv: optional("NODE_ENV", "development"),
} as const;

// Log which environment we're running in (helps with debugging).
console.log(
  `[config] Loaded — NODE_ENV=${config.nodeEnv}, PORT=${config.port}`
);
