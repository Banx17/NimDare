// JWT helpers (Stage 3).
//
// Thin wrappers around the `jsonwebtoken` library so the rest of the app
// doesn't need to know the details (secret, expiry, payload shape). It also
// gives us a single typed payload interface shared by everything that issues
// or consumes tokens.

import jwt from "jsonwebtoken";
import { config } from "../config";

// A Nimiq user is identified in a JWT by their MongoDB _id and wallet
// address. This is the minimal set of claims we put in the token.
export interface TokenPayload {
  id: string; // Mongo _id (as a string)
  walletAddress: string;
}

// How long the token stays valid. ~7 days.
const TOKEN_EXPIRY = "7d";

// Calls process.exit(1) if JWT_SECRET is empty/missing — same "fail fast"
// philosophy as the config module. Since config.jwtSecret came from
// required(), it shouldn't be empty unless something else went wrong, but we
// guard anyway so we never sign with an empty secret.
function getSecret(): string {
  if (typeof config.jwtSecret !== "string" || config.jwtSecret.length === 0) {
    console.error(
      "\n❌  JWT_SECRET is missing or empty. Cannot sign tokens.\n" +
        "    Add it to backend/.env (see backend/.env.example)."
    );
    process.exit(1);
  }
  return config.jwtSecret;
}

// Creates a signed JWT containing the given payload.
export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, getSecret(), { expiresIn: TOKEN_EXPIRY });
}

// Verifies + decodes a token.
//   - Returns the decoded payload on success.
//   - Returns null if the token is malformed, invalid, expired, or has the
//     wrong signature.
// We return null (rather than throwing) so callers like the middleware can
// just treat a null result as "401, no token".
export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, getSecret());
    // jwt.verify returns string | JwtPayload. For our tokens it should always
    // be the object form; if it's only a string something is wrong.
    if (typeof decoded === "string") return null;
    const { id, walletAddress } = decoded as Partial<TokenPayload>;
    if (typeof id !== "string" || typeof walletAddress !== "string") {
      return null;
    }
    return { id, walletAddress };
  } catch {
    // Invalid signature / expired / malformed all land here.
    return null;
  }
}
