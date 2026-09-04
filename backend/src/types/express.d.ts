// Express type augmentations.
//
// We attach the authenticated user to the Express Request object as
// `req.user` inside auth middleware. This file augments Express's built-in
// `Request` type via declaration merging so that handlers after the auth
// middleware can access `req.user` with full type safety.

import type { TokenPayload } from "../utils/jwt";

declare global {
  namespace Express {
    interface Request {
      // Set by `authenticate` middleware when a valid JWT is present.
      // Undefined when the request is unauthenticated.
      user?: TokenPayload;
    }
  }
}

export {};
