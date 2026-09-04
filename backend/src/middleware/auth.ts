// Auth middleware (Stage 3).
//
// `requireAuth` is an Express middleware that protects routes by requiring a
// valid `Authorization: Bearer <token>` header. If the token is missing,
// malformed, or invalid it responds 401 with a clear message. On success it
// attaches the decoded user ({ id, walletAddress }) to `req.user` and calls
// `next()`.

import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt";

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;

  // 1. Header must exist.
  if (!header) {
    res
      .status(401)
      .json({ error: "Missing Authorization header. Use: Bearer <token>" });
    return;
  }

  // 2. Header must be "Bearer <token>".
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    res
      .status(401)
      .json({ error: "Malformed Authorization header. Expected: Bearer <token>" });
    return;
  }

  // 3. Token must verify + decode.
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token." });
    return;
  }

  // 4. Attach user and continue.
  req.user = payload;
  next();
}
