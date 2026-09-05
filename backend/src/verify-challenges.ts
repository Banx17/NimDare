// ⚠️  TEMPORARY VERIFICATION SCRIPT — NOT part of the application.
//     Proves the Stage 4 Challenge CRUD business rules by exercising the
//     actual service layer against a real MongoDB:
//       1. Create a challenge as the creator (status forced to 'draft', type 'solo').
//       2. Explicit non-solo `type` is rejected up front.
//       3. Validation: missing fields, non-positive nimAmount, endDate <= startDate.
//       4. Public list + get (creator filter, pagination).
//       5. Status transitions: draft->active->completed (creator only). Since
//          Stage 8, completing a proofRequired challenge needs an approved
//          proof — verified here (blocked without, allowed with one).
//       6. Invalid transition rejected (e.g. draft->completed, active->draft).
//       7. Non-creator is forbidden from status updates and deletes.
//       8. Only a DRAFT challenge can be deleted; active/completed cannot.
//       9. A challenge that does not exist -> NotFoundError.
//     Ends by deleting every test user + challenge (no docs left behind).
//
//     Run it with:  npm run verify:challenges
//     Remove this script once Stage 4 is confirmed to work.

import { connectDatabase } from "./config/database";
import mongoose from "mongoose";
import { User, Challenge, Proof, IChallenge } from "./models";
import { connectWallet } from "./services/auth";
import { signToken } from "./utils/jwt";
import {
  createChallenge,
  listChallenges,
  getChallengeById,
  updateChallengeStatus,
  deleteChallenge,
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "./services/challenges";
import { submitProof, verifyProof } from "./services/proofs";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
}

const future = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
};

async function verify() {
  console.log("\n=== NimDare Challenge-CRUD verification start ===\n");
  await connectDatabase();

  // --- 0. Two test users: the challenge creator + a stranger ---
  const creator = await connectWallet("NQ_TEST_CH_CREATOR_0001");
  const stranger = await connectWallet("NQ_TEST_CH_STRANGER_0001");
  const creatorId = creator._id.toString();
  const strangerId = stranger._id.toString();
  const createdChallenges: string[] = [];

  // --- 1. createChallenge: happy path ---
  const ch = await createChallenge(creatorId, {
    title: "Read 20 pages of a book",
    description: "Finish 20 pages tonight.",
    rules: "Read them properly.",
    nimAmount: 10,
    startDate: future(0),
    endDate: future(7),
  });
  createdChallenges.push(ch._id.toString());
  check(
    "[1] create sets status='draft', type='solo'",
    ch.status === "draft" && ch.type === "solo" && ch.creator.toString() === creatorId,
    `status=${ch.status} type=${ch.type}`
  );
  check(
    "[1] proofRequired defaults to true (model default)",
    ch.proofRequired === true,
    `proofRequired=${ch.proofRequired}`
  );

  // --- 2. explicit non-solo type is rejected ---
  let err2: unknown;
  try {
    await createChallenge(creatorId, {
      title: "x",
      description: "y",
      rules: "z",
      nimAmount: 5,
      startDate: future(0),
      endDate: future(1),
      type: "friend",
    });
  } catch (e) {
    err2 = e;
  }
  check("[2] type='friend' rejected", err2 instanceof ValidationError, String(err2));

  // --- 3. validation cases ---
  const cases: Array<[string, Record<string, unknown>]> = [
    ["missing title", { description: "y", rules: "z", nimAmount: 5, startDate: future(0), endDate: future(1) }],
    ["nimAmount not positive", { title: "t", description: "y", rules: "z", nimAmount: 0, startDate: future(0), endDate: future(1) }],
    ["nimAmount missing", { title: "t", description: "y", rules: "z", startDate: future(0), endDate: future(1) }],
    ["endDate not after startDate", { title: "t", description: "y", rules: "z", nimAmount: 5, startDate: future(2), endDate: future(1) }],
  ];
  for (const [label, body] of cases) {
    let e: unknown;
    try {
      await createChallenge(creatorId, body);
    } catch (ex) {
      e = ex;
    }
    check(`[3] ${label} -> ValidationError`, e instanceof ValidationError, String(e));
  }

  // --- 4. public list + get ---
  const all = await listChallenges({});
  check("[4] list returns the created challenge", all.total >= 1);
  const mine = await listChallenges({ creator: creatorId });
  check("[4] list filtered by creator", mine.total >= 1);
  const withStatus = await listChallenges({ status: "draft", creator: creatorId });
  check("[4] list filtered by status", withStatus.total >= 1);
  const page = await listChallenges({ creator: creatorId, page: 1, limit: 1 });
  check("[4] pagination limits results", page.challenges.length === 1);
  const fetched = await getChallengeById(ch._id.toString());
  check("[4] getChallengeById returns the doc", fetched._id.toString() === ch._id.toString());

  // --- 5. status transitions: draft -> active -> completed ---
  const act = await updateChallengeStatus(ch._id.toString(), creatorId, "active");
  check("[5] draft -> active", act.status === "active", `status=${act.status}`);
  // Stage 8 completion gate: `ch` was created without an explicit
  // proofRequired, so it defaults to TRUE — completing therefore needs an
  // approved proof first (submit + self-approve, exactly like the app will).
  let e5 = false;
  try {
    await updateChallengeStatus(ch._id.toString(), creatorId, "completed");
  } catch (ex) {
    e5 = true;
  }
  check("[5] active -> completed blocked WITHOUT approved proof", e5, e5 ? "" : "completed succeeded without proof");
  const proof = await submitProof(ch._id.toString(), creatorId, {
    content: "Stage 8 gate: evidence of completion",
  });
  await verifyProof(proof._id.toString(), creatorId, "approved");
  const comp = await updateChallengeStatus(ch._id.toString(), creatorId, "completed");
  check("[5] active -> completed (with approved proof)", comp.status === "completed", `status=${comp.status}`);

  // --- 6. invalid transitions rejected ---
  const ch2 = await createChallenge(creatorId, {
    title: "draft -> completed directly",
    description: "y", rules: "z", nimAmount: 1, startDate: future(0), endDate: future(2),
  });
  createdChallenges.push(ch2._id.toString());
  let e6a: unknown;
  try {
    await updateChallengeStatus(ch2._id.toString(), creatorId, "completed");
  } catch (ex) {
    e6a = ex;
  }
  check("[6] draft -> completed rejected", e6a instanceof ValidationError, String(e6a));

  await updateChallengeStatus(ch2._id.toString(), creatorId, "active");
  let e6b: unknown;
  try {
    await updateChallengeStatus(ch2._id.toString(), creatorId, "draft");
  } catch (ex) {
    e6b = ex;
  }
  check("[6] active -> draft rejected", e6b instanceof ValidationError, String(e6b));

  let e6c: unknown;
  try {
    await updateChallengeStatus(ch2._id.toString(), creatorId, "bogus-status");
  } catch (ex) {
    e6c = ex;
  }
  check("[6] unknown status value rejected", e6c instanceof ValidationError, String(e6c));

  // --- 7. non-creator forbidden ---
  let e7a: unknown;
  try {
    await updateChallengeStatus(ch2._id.toString(), strangerId, "failed");
  } catch (ex) {
    e7a = ex;
  }
  check("[7] non-creator status update -> Forbidden", e7a instanceof ForbiddenError, String(e7a));
  let e7b: unknown;
  try {
    await deleteChallenge(ch2._id.toString(), strangerId);
  } catch (ex) {
    e7b = ex;
  }
  check("[7] non-creator delete -> Forbidden", e7b instanceof ForbiddenError, String(e7b));

  // --- 8. only DRAFT can be deleted ---
  // a fresh DRAFT challenge can be deleted...
  const ch4 = await createChallenge(creatorId, {
    title: "draft can be deleted",
    description: "y", rules: "z", nimAmount: 1, startDate: future(0), endDate: future(2),
  });
  createdChallenges.push(ch4._id.toString());
  await deleteChallenge(ch4._id.toString(), creatorId);
  let still = await Challenge.findById(ch4._id);
  check("[8] draft deleted successfully", still === null);

  // ...but ch3 is ACTIVE, so deletion is rejected.
  const ch3 = await createChallenge(creatorId, {
    title: "active cannot be deleted",
    description: "y", rules: "z", nimAmount: 1, startDate: future(0), endDate: future(2),
  });
  createdChallenges.push(ch3._id.toString());
  await updateChallengeStatus(ch3._id.toString(), creatorId, "active");
  let e8: unknown;
  try {
    await deleteChallenge(ch3._id.toString(), creatorId);
  } catch (ex) {
    e8 = ex;
  }
  check("[8] active delete rejected", e8 instanceof ValidationError, String(e8));

  // --- 9. not found ---
  let e9: unknown;
  try {
    await getChallengeById(new mongoose.Types.ObjectId().toString());
  } catch (ex) {
    e9 = ex;
  }
  check("[9] missing challenge -> NotFound", e9 instanceof NotFoundError, String(e9));

  // --- cleanup ---
  const createdObjectIds = createdChallenges.map((id) => new mongoose.Types.ObjectId(id));
  await Proof.deleteMany({ challenge: { $in: createdObjectIds } });
  await Challenge.deleteMany({ _id: { $in: createdObjectIds } });
  await User.deleteMany({ _id: { $in: [creator._id, stranger._id] } });
  const leftovers = await Challenge.countDocuments({ _id: { $in: createdObjectIds } });
  const leftoverProofs = await Proof.countDocuments({ challenge: { $in: createdObjectIds } });
  const leftoverUsers = await User.countDocuments({ _id: { $in: [creator._id, stranger._id] } });
  check("cleanup: no leftover challenges", leftovers === 0, `left=${leftovers}`);
  check("cleanup: no leftover proofs", leftoverProofs === 0, `left=${leftoverProofs}`);
  check("cleanup: no leftover users", leftoverUsers === 0, `left=${leftoverUsers}`);

  await mongoose.disconnect();
  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

verify().catch((err) => {
  console.error("\n❌  Verification FAILED:", err);
  process.exit(1);
});
