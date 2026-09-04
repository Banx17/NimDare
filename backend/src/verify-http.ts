// ⚠️  TEMPORARY HTTP SMOKE TEST (Stage 4) — NOT part of the application.
//     Exercises the REAL server end-to-end (routes, controllers, auth
//     middleware, service) over HTTP:
//       1. Unauthenticated POST -> 401 (requireAuth protects creation).
//       2. Authenticated POST (valid JWT) -> 201 with a 'draft'/'solo' challenge.
//       3. GET /api/challenges (public) -> 200 list contains it.
//       4. GET /api/challenges/:id (public) -> 200 detail.
//       5. GET /api/challenges/not-an-id -> clean 400 (malformed ObjectId).
//       6. PATCH /:id/status with creator -> 200.
//       7. PATCH /:id/status with a NON-creator -> 403.
//       8. DELETE /:id with creator on a DRAFT -> 204.
//     Cleans up all test users/challenges afterwards.

import { connectDatabase } from "./config/database";
import mongoose from "mongoose";
import { User, Challenge } from "./models";
import { connectWallet } from "./services/auth";
import { signToken } from "./utils/jwt";

const BASE = "http://localhost:3001";
const future = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

async function req(method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(BASE + path, init);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, data };
}

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail = "") {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

async function smoke() {
  console.log("\n=== NimDare Challenge HTTP smoke test start ===");
  await connectDatabase();

  const creator = await connectWallet("NQ_TEST_HTTP_CREATOR_0001");
  const stranger = await connectWallet("NQ_TEST_HTTP_STRANGER_0001");
  const creatorToken = signToken({ id: creator._id.toString(), walletAddress: creator.walletAddress });
  const strangerToken = signToken({ id: stranger._id.toString(), walletAddress: stranger.walletAddress });
  const createdChallenges: string[] = [];

  // 1. Unauthenticated create -> 401
  const ua = await req("POST", "/api/challenges", { title: "x", description: "y", rules: "z", nimAmount: 1, startDate: future(0).toISOString(), endDate: future(1).toISOString() });
  check("[1] unauth POST -> 401", ua.status === 401, `got ${ua.status}`);

  // 2. Authenticated create -> 201
  const c = await req("POST", "/api/challenges", {
    title: "HTTP smoke challenge",
    description: "desc", rules: "rules", nimAmount: 10,
    startDate: future(1).toISOString(), endDate: future(8).toISOString(),
  }, creatorToken);
  const ch = (c.data as any)?.challenge;
  createdChallenges.push(ch?._id);
  check("[2] auth POST -> 201", c.status === 201, `got ${c.status}`);
  check("[2] response is draft+solo", ch?.status === "draft" && ch?.type === "solo");

  // 3. Public GET list
  const list = await req("GET", "/api/challenges");
  check("[3] GET list -> 200", list.status === 200, `got ${list.status}`);
  check("[3] list contains created id", !!ch && (list.data as any)?.total >= 1);

  // 4. Public GET by id
  const byId = await req("GET", `/api/challenges/${ch._id}`);
  check("[4] GET /:id -> 200", byId.status === 200, `got ${byId.status}`);
  check("[4] returns matching id", (byId.data as any)?.challenge?._id === ch._id);

  // 5. Malformed id -> clean 400
  const bad = await req("GET", "/api/challenges/not-an-object-id");
  check("[5] malformed id -> 400", bad.status === 400, `got ${bad.status} data=${JSON.stringify(bad.data)}`);

  // 6. Creator status update -> 200
  const up = await req("PATCH", `/api/challenges/${ch._id}/status`, { status: "active" }, creatorToken);
  check("[6] creator PATCH status -> 200", up.status === 200, `got ${up.status}`);
  check("[6] status now active", (up.data as any)?.challenge?.status === "active");

  // 7. Non-creator status update -> 403
  const non = await req("PATCH", `/api/challenges/${ch._id}/status`, { status: "completed" }, strangerToken);
  check("[7] non-creator PATCH -> 403", non.status === 403, `got ${non.status}`);

  // 8. Delete draft -> but this challenge is now active; use a fresh draft.
  const d = await req("POST", "/api/challenges", {
    title: "delete-me", description: "d", rules: "r", nimAmount: 1,
    startDate: future(1).toISOString(), endDate: future(2).toISOString(),
  }, creatorToken);
  const draftId = (d.data as any)?.challenge?._id;
  createdChallenges.push(draftId);
  const del = await req("DELETE", `/api/challenges/${draftId}`, undefined, creatorToken);
  check("[8] creator DELETE draft -> 204", del.status === 204, `got ${del.status}`);

  // also confirm active challenge cannot be deleted via HTTP -> 400
  const delActive = await req("DELETE", `/api/challenges/${ch._id}`, undefined, creatorToken);
  check("[8] creator DELETE active -> 400", delActive.status === 400, `got ${delActive.status}`);

  // --- cleanup ---
  await Challenge.deleteMany({ _id: { $in: createdChallenges } });
  await User.deleteMany({ _id: { $in: [creator._id, stranger._id] } });
  await mongoose.disconnect();
  console.log(`\n=== HTTP smoke RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

smoke().catch((e) => {
  console.error("\n❌  Smoke test FAILED:", e);
  process.exit(1);
});
