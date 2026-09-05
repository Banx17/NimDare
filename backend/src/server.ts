// NimDare — Express Server (Stages 1-4)
//
// This is the entry point for the backend. It creates an Express application,
// attaches basic middleware, mounts routes (including wallet auth), connects
// to MongoDB, and starts listening.

import express from "express";
import cors from "cors";
import { config } from "./config";
import { connectDatabase } from "./config/database";
import authRoutes from "./routes/auth";
import challengeRoutes from "./routes/challenges";
import proofRoutes from "./routes/proofs";
import { requireAuth } from "./middleware/auth";
import { meHandler } from "./controllers/authController";

// ----- create app -----

const app = express();

// ----- middleware -----

// cors() lets the frontend (running on a different origin/port during
// development) make requests to this backend without browser errors.
//
// The allowed origin is read from CORS_ORIGIN (config.corsOrigin) in
// backend/.env — set it to EXACTLY the origin of the "Network URL" that Nimiq
// Pay is loading the Mini App from (e.g. http://192.168.1.100:5173). That URL
// changes whenever your machine's LAN IP changes, which is why we never
// hardcode it here. "*" (the default) allows any origin for dev convenience.
//
// origin is `undefined` for requests without an Origin header (curl, server-
// to-server) — those are always allowed. callback(null, false) means "deny":
// the browser then blocks the request because no CORS header is sent.
app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = config.corsOrigin;
      const isAllowed =
        !origin || allowed === "*" || allowed === origin;
      callback(null, isAllowed);
    },
  })
);

// express.json() parses incoming JSON request bodies so we can access
// them later via req.body.
app.use(express.json());

// ----- routes -----

// Health check — returns a simple JSON object so we (and monitoring tools)
// can quickly verify that the server is up and reachable.
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// ----- auth routes -----

// Wallet-based auth endpoints (connect + verify).
app.use("/api/auth", authRoutes);

// Challenge CRUD (solo challenges only for the MVP).
app.use("/api/challenges", challengeRoutes);

// Proof submission/listing (mounted under challenges) + proof self-verification
// (mounted under /api/proofs) — see routes/proofs.ts.
app.use("/api/challenges", proofRoutes);
app.use("/api/proofs", proofRoutes);

// Protected test route — requires a valid JWT and returns the current user
// fresh from MongoDB (the auth middleware attaches req.user).
app.get("/api/me", requireAuth, meHandler);

// ----- start server -----

// Boot sequence: connect to the database FIRST, then start listening.
// connectDatabase() exits the process itself if the connection fails, so the
// server only starts listening once we actually have a working database.
async function start() {
  await connectDatabase();

  app.listen(config.port, () => {
    console.log(
      `[server] NimDare backend running — http://localhost:${config.port}`
    );
  });
}

start();
