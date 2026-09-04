// Challenge routes (Stage 4).
//
// Challenge CRUD mounted at /api/challenges.
//   - POST   /                        (protected) create a solo challenge
//   - GET    /                        (public)   list, with filters/pagination
//   - GET    /:id                     (public)   view one challenge
//   - PATCH  /:id/status              (protected) creator changes status
//   - DELETE /:id                     (protected) creator deletes a draft

import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  createChallengeHandler,
  listChallengesHandler,
  getChallengeHandler,
  updateStatusHandler,
  deleteChallengeHandler,
} from "../controllers/challenges";

const router = Router();

// Public read routes.
router.get("/", listChallengesHandler);
router.get("/:id", getChallengeHandler);

// Protected write routes.
router.post("/", requireAuth, createChallengeHandler);
router.patch("/:id/status", requireAuth, updateStatusHandler);
router.delete("/:id", requireAuth, deleteChallengeHandler);

export default router;
