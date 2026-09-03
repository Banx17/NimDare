// NimDare — Express Server (Stage 1)
//
// This is the entry point for the backend. It creates an Express application,
// attaches basic middleware, mounts routes, and starts listening.

import express from "express";
import cors from "cors";
import { config } from "./config";

// ----- create app -----

const app = express();

// ----- middleware -----

// cors() lets the frontend (running on a different origin/port during
// development) make requests to this backend without browser errors.
app.use(cors());

// express.json() parses incoming JSON request bodies so we can access
// them later via req.body.
app.use(express.json());

// ----- routes -----

// Health check — returns a simple JSON object so we (and monitoring tools)
// can quickly verify that the server is up and reachable.
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// ----- start server -----

app.listen(config.port, () => {
  console.log(
    `[server] NimDare backend running — http://localhost:${config.port}`
  );
});
