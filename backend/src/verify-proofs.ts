// ⚠️  TEMPORARY VERIFICATION SCRIPT — NOT part of the application.
//     Proves the Stage 8 proof system + completion gate by exercising the
//     actual service layer against a real MongoDB:
//       1. Creator submits a proof for their own ACTIVE challenge -> pending.
//          Empty content is rejected.
//       2. A non-creator cannot submit (ForbiddenError).
//       3. Submitting for a draft / completed / failed challenge is rejected.
//       4. Self-verification: approve + reject work; a proof cannot be
//          re-verified; non-creators can't verify; bad decision rejected;
//          missing proof -> NotFoundError.
//       5. Completion gate: active -> completed is BLOCKED without an approved
//          proof (even with a pending one) and ALLOWED once one exists; a
//          proofRequired:false challenge still completes with no proof;
//          active -> failed never needs a proof.
//       6. listProofsForChallenge returns the challenge's proofs; a
//          nonexistent challenge -> NotFoundError.
//     Ends by deleting every test user / challenge / proof it created.
//
//     Run it with:  npm run verify:proofs
//     Remove this script once Stage 8 is confirmed to work.

import { connectDatabase } from "./config/database";
import mongoose from "mongoose";
import { User, Challenge, Proof } from "./models";
import { connectWallet } from "./services/auth";
import {
  createChallenge,
  updateChallengeStatus,
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "./services/challenges";
import {
  submitProof,
  listProofsForChallenge,
  verifyProof,
} from "./services/proofs";

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
  console.log("\n=== NimDare proofs + completion-gate verification start ===\n");
  await connectDatabase();

  // --- 0. Two test users: the challenge creator + a stranger ---
  const creator = await connectWallet("NQ_TEST_PROOF_CREATOR_0001");
  const stranger = await connectWallet("NQ_TEST_PROOF_STRANGER_0001");
  const creatorId = creator._id.toString();
  const strangerId = stranger._id.toString();
  const challengeIds: string[] = [];

  const makeChallenge = async (opts: { title: string; proofRequired?: boolean }) => {
    const ch = await createChallenge(creatorId, {
      title: opts.title,
      description: "Stage 8 verification challenge.",
      rules: "Evidence needed.",
      nimAmount: 5,
      startDate: future(0),
      endDate: future(7),
      ...(opts.proofRequired !== undefined ? { proofRequired: opts.proofRequired } : {}),
    });
    challengeIds.push(ch._id.toString());
    return ch;
  };

  // ---- 1. Submit proof for an own ACTIVE challenge (happy path) ----
  const ch1 = await makeChallenge({ title: "proof target" });
  await updateChallengeStatus(ch1._id.toString(), creatorId, "active");
  const p1 = await submitProof(ch1._id.toString(), creatorId, {
    content: "Here is my evidence.",
    images: ["https://example.com/proof-1.png"],
  });
  check(
    "[1] submit returns a PENDING proof wired to challenge+user",
    p1.status === "pending" &&
      p1.challenge.toString() === ch1._id.toString() &&
      p1.user.toString() === creatorId,
    `status=${p1.status}`
  );
  check(
    "[1] images array carried through",
    !!p1.images && p1.images.length === 1 && p1.images[0] === "https://example.com/proof-1.png",
    `images=${JSON.stringify(p1.images)}`
  );
  let e1: unknown;
  try {
    await submitProof(ch1._id.toString(), creatorId, { content: "" });
  } catch (ex) {
    e1 = ex;
  }
  check("[1] empty content rejected", e1 instanceof ValidationError, String(e1));

  // ---- 2. Non-creator cannot submit ----
  let e2: unknown;
  try {
    await submitProof(ch1._id.toString(), strangerId, { content: "hijack" });
  } catch (ex) {
    e2 = ex;
  }
  check("[2] non-creator submit -> Forbidden", e2 instanceof ForbiddenError, String(e2));

  // ---- 3. Non-active challenges reject submission ----
  // draft
  const chDraft = await makeChallenge({ title: "draft target" });
  let e3a: unknown;
  try {
    await submitProof(chDraft._id.toString(), creatorId, { content: "x" });
  } catch (ex) {
    e3a = ex;
  }
  check("[3] submit for DRAFT -> rejected", e3a instanceof ValidationError, String(e3a));

  // completed (need to complete it first: proof + approve + complete)
  const chCompleted = await makeChallenge({ title: "completed target" });
  await updateChallengeStatus(chCompleted._id.toString(), creatorId, "active");
  const pComplete = await submitProof(chCompleted._id.toString(), creatorId, { content: "done it" });
  await verifyProof(pComplete._id.toString(), creatorId, "approved");
  await updateChallengeStatus(chCompleted._id.toString(), creatorId, "completed");
  let e3b: unknown;
  try {
    await submitProof(chCompleted._id.toString(), creatorId, { content: "too late" });
  } catch (ex) {
    e3b = ex;
  }
  check("[3] submit for COMPLETED -> rejected", e3b instanceof ValidationError, String(e3b));

  // failed
  const chFailed = await makeChallenge({ title: "failed target" });
  await updateChallengeStatus(chFailed._id.toString(), creatorId, "active");
  await updateChallengeStatus(chFailed._id.toString(), creatorId, "failed");
  let e3c: unknown;
  try {
    await submitProof(chFailed._id.toString(), creatorId, { content: "too late" });
  } catch (ex) {
    e3c = ex;
  }
  check("[3] submit for FAILED -> rejected", e3c instanceof ValidationError, String(e3c));

  // ---- 4. Self-verification ----
  // 4a. creator approves p1
  const approved = await verifyProof(p1._id.toString(), creatorId, "approved");
  check(
    "[4] approve own proof -> approved + verifiedAt set",
    approved.status === "approved" && !!approved.verifiedAt,
    `status=${approved.status} verifiedAt=${approved.verifiedAt}`
  );

  // 4b. already-verified proof cannot be re-verified
  let e4b: unknown;
  try {
    await verifyProof(p1._id.toString(), creatorId, "rejected");
  } catch (ex) {
    e4b = ex;
  }
  check("[4] re-verify an APPROVED proof -> rejected", e4b instanceof ValidationError, String(e4b));

  // 4c. creator rejects a second proof
  const p2 = await submitProof(ch1._id.toString(), creatorId, { content: "second attempt" });
  const rejected = await verifyProof(p2._id.toString(), creatorId, "rejected");
  check("[4] reject own proof -> rejected + verifiedAt set", rejected.status === "rejected" && !!rejected.verifiedAt, `status=${rejected.status}`);

  // 4d. re-verify a REJECTED proof -> rejected
  let e4d: unknown;
  try {
    await verifyProof(p2._id.toString(), creatorId, "approved");
  } catch (ex) {
    e4d = ex;
  }
  check("[4] re-verify a REJECTED proof -> rejected", e4d instanceof ValidationError, String(e4d));

  // 4e. non-creator cannot verify
  let e4e: unknown;
  try {
    await verifyProof(p2._id.toString(), strangerId, "approved");
  } catch (ex) {
    e4e = ex;
  }
  check("[4] non-creator verify -> Forbidden", e4e instanceof ForbiddenError, String(e4e));

  // 4f. invalid decision value
  let e4f: unknown;
  try {
    await verifyProof(p2._id.toString(), creatorId, "bogus-decision");
  } catch (ex) {
    e4f = ex;
  }
  check("[4] bogus decision -> rejected", e4f instanceof ValidationError, String(e4f));

  // 4g. nonexistent proof
  let e4g: unknown;
  try {
    await verifyProof(new mongoose.Types.ObjectId().toString(), creatorId, "approved");
  } catch (ex) {
    e4g = ex;
  }
  check("[4] missing proof -> NotFound", e4g instanceof NotFoundError, String(e4g));

  // ---- 5. Completion gate ----
  // 5a. BLOCKED without an approved proof (and still blocked with only a PENDING one)
  const chGate = await makeChallenge({ title: "gated completion" });
  await updateChallengeStatus(chGate._id.toString(), creatorId, "active");
  let e5a: unknown;
  try {
    await updateChallengeStatus(chGate._id.toString(), creatorId, "completed");
  } catch (ex) {
    e5a = ex;
  }
  check("[5] complete WITHOUT any proof -> blocked", e5a instanceof ValidationError, String(e5a));

  const pendingOnly = await submitProof(chGate._id.toString(), creatorId, { content: "evidence, not yet approved" });
  let e5b: unknown;
  try {
    await updateChallengeStatus(chGate._id.toString(), creatorId, "completed");
  } catch (ex) {
    e5b = ex;
  }
  check("[5] complete with PENDING proof only -> still blocked", e5b instanceof ValidationError, String(e5b));

  // 5b. ALLOWED once a proof is approved
  await verifyProof(pendingOnly._id.toString(), creatorId, "approved");
  const completed = await updateChallengeStatus(chGate._id.toString(), creatorId, "completed");
  check("[5] complete with APPROVED proof -> allowed", completed.status === "completed", `status=${completed.status}`);

  // 5c. proofRequired:false -> completes with NO proof (unchanged behavior)
  const chNoProof = await makeChallenge({ title: "no proof needed", proofRequired: false });
  await updateChallengeStatus(chNoProof._id.toString(), creatorId, "active");
  const compNoProof = await updateChallengeStatus(chNoProof._id.toString(), creatorId, "completed");
  check("[5] proofRequired:false completes without proof", compNoProof.status === "completed", `status=${compNoProof.status}`);

  // 5d. active -> failed needs no proof even when proofRequired:true
  const chFail = await makeChallenge({ title: "give up" });
  await updateChallengeStatus(chFail._id.toString(), creatorId, "active");
  const failed = await updateChallengeStatus(chFail._id.toString(), creatorId, "failed");
  check("[5] active -> failed (proofRequired:true) without proof -> allowed", failed.status === "failed", `status=${failed.status}`);

  // ---- 6. Listing ----
  const list = await listProofsForChallenge(ch1._id.toString());
  check("[6] list all proofs for ch1 (2 proofs)", list.length === 2, `count=${list.length}`);
  const listGate = await listProofsForChallenge(chGate._id.toString());
  check("[6] list proofs for gated challenge (1 proof)", listGate.length === 1, `count=${listGate.length}`);
  let e6b: unknown;
  try {
    await listProofsForChallenge(new mongoose.Types.ObjectId().toString());
  } catch (ex) {
    e6b = ex;
  }
  check("[6] list for missing challenge -> NotFound", e6b instanceof NotFoundError, String(e6b));

  // ---- 7. Non-creator cannot UPDATE status either (sanity, self-verification guard) ----
  const chStrangerWrite = await makeChallenge({ title: "stranger attempts gate" });
  await updateChallengeStatus(chStrangerWrite._id.toString(), creatorId, "active");
  let e7: unknown;
  try {
    await updateChallengeStatus(chStrangerWrite._id.toString(), strangerId, "failed");
  } catch (ex) {
    e7 = ex;
  }
  check("[7] non-creator status change -> Forbidden", e7 instanceof ForbiddenError, String(e7));

  // --- cleanup ---
  const createdObjectIds = challengeIds.map((id) => new mongoose.Types.ObjectId(id));
  await Proof.deleteMany({ challenge: { $in: createdObjectIds } });
  await Challenge.deleteMany({ _id: { $in: createdObjectIds } });
  await User.deleteMany({ _id: { $in: [creator._id, stranger._id] } });
  const leftChallenges = await Challenge.countDocuments({ _id: { $in: createdObjectIds } });
  const leftProofs = await Proof.countDocuments({ challenge: { $in: createdObjectIds } });
  const leftUsers = await User.countDocuments({ _id: { $in: [creator._id, stranger._id] } });
  check("cleanup: no leftover challenges", leftChallenges === 0, `left=${leftChallenges}`);
  check("cleanup: no leftover proofs", leftProofs === 0, `left=${leftProofs}`);
  check("cleanup: no leftover users", leftUsers === 0, `left=${leftUsers}`);

  await mongoose.disconnect();
  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}

verify().catch((err) => {
  console.error("\n❌  Verification FAILED:", err);
  process.exit(1);
});