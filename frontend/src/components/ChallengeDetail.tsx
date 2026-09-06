// Challenge detail view (Stages 7-9).
//
// Fetches one challenge by id (public GET) plus its proofs (public GET). If
// the logged-in user is the creator, the right action buttons for the current
// status are shown and the matching backend calls run — the returned challenge
// replaces the one on screen, so the view always reflects server state.
// Non-creators (and logged-out visitors) see the challenge read-only.
//
// Proofs (Stage 9): the creator can submit proof for an ACTIVE challenge and
// self-verify (approve/reject) pending proofs. The same person submits AND
// verifies — that is the honest MVP model, and the note by the list says so
// plainly. The "Mark Completed" button mirrors the Stage 8 backend gate: on a
// proofRequired challenge it is disabled, with an explanation, until a proof
// has been approved. After a submit/verify the list and buttons update in
// place — no page reload needed.

import { useEffect, useState, type FormEvent } from "react";
import {
  deleteChallenge,
  getChallenge,
  listProofs,
  submitProof,
  updateChallengeStatus,
  verifyProof,
  type Challenge,
  type Proof,
  type ProofStatus,
  type VerifyDecision,
} from "../api";
import { formatDateTime, shorten } from "../format";

interface ChallengeDetailProps {
  challengeId: string;
  token: string | null; // null when logged out
  userId: string | null; // _id of the logged-in user, null when logged out
  onBack: () => void; // navigate back to the list
  onDeleted: () => void; // challenge was deleted — leave the detail view
}

const STATUS_LABELS: Record<Challenge["status"], string> = {
  draft: "Draft",
  active: "Active",
  completed: "Completed",
  failed: "Failed",
};

const STATUS_BADGE: Record<Challenge["status"], string> = {
  draft: "bg-zinc-100 text-zinc-700",
  active: "bg-emerald-100 text-emerald-800",
  completed: "bg-sky-100 text-sky-800",
  failed: "bg-red-100 text-red-700",
};

const PROOF_STATUS_LABELS: Record<ProofStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
};

const PROOF_STATUS_BADGE: Record<ProofStatus, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-700",
};

// One labelled row of the detail card.
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <dt className="shrink-0 text-zinc-500">{label}</dt>
      <dd className="truncate text-right font-mono text-xs text-zinc-700">
        {value}
      </dd>
    </div>
  );
}

// One proof entry in the list. `canVerify` is true only for the creator
// looking at their own PENDING proof — the honest self-verification controls.
function ProofCard({
  proof,
  canVerify,
  verifyBusyId,
  onVerify,
}: {
  proof: Proof;
  canVerify: boolean;
  verifyBusyId: string | null; // proof currently being verified (disables all)
  onVerify: (proofId: string, decision: VerifyDecision) => void;
}) {
  const isBusy = verifyBusyId === proof._id;
  return (
    <li className="rounded-md border border-zinc-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${PROOF_STATUS_BADGE[proof.status]}`}
        >
          {PROOF_STATUS_LABELS[proof.status]}
        </span>
        <span className="text-xs text-zinc-400">
          Submitted {formatDateTime(proof.createdAt)}
        </span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">
        {proof.content}
      </p>

      {proof.images && proof.images.length > 0 && (
        <ul className="mt-2 space-y-1">
          {proof.images.map((url, i) => (
            <li key={`${url}-${i}`}>
              <a href={url} className="break-all text-xs text-sky-600 underline">
                {shorten(url, 48)}
              </a>
            </li>
          ))}
        </ul>
      )}

      {proof.verifiedAt && (
        <p className="mt-1 text-xs text-zinc-400">
          Reviewed {formatDateTime(proof.verifiedAt)}
        </p>
      )}

      {canVerify && (
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => onVerify(proof._id, "approved")}
            disabled={verifyBusyId !== null}
            className="flex-1 rounded-lg bg-emerald-600 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? "Verifying&hellip;" : "Approve"}
          </button>
          <button
            onClick={() => onVerify(proof._id, "rejected")}
            disabled={verifyBusyId !== null}
            className="flex-1 rounded-lg bg-red-600 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? "Verifying&hellip;" : "Reject"}
          </button>
        </div>
      )}
    </li>
  );
}

export function ChallengeDetail({
  challengeId,
  token,
  userId,
  onBack,
  onDeleted,
}: ChallengeDetailProps) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); // a status/delete action is in flight
  const [actionError, setActionError] = useState<string | null>(null);

  // ---- Stage 9 proof state ----
  const [proofs, setProofs] = useState<Proof[] | null>(null);
  const [proofsError, setProofsError] = useState<string | null>(null);
  const [proofsActionError, setProofsActionError] = useState<string | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [verifyBusyId, setVerifyBusyId] = useState<string | null>(null);
  const [proofContent, setProofContent] = useState("");
  // One row per image URL; rows can be added/removed (URLs only, no upload).
  const [proofImageUrls, setProofImageUrls] = useState<string[]>([""]);

  // Fetch the challenge (fresh) whenever the selected id changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getChallenge(challengeId)
      .then(({ challenge }) => {
        if (!cancelled) setChallenge(challenge);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [challengeId]);

  // Fetch the proof list (public) whenever the challenge id changes.
  useEffect(() => {
    let cancelled = false;
    setProofs(null);
    setProofsError(null);

    listProofs(challengeId)
      .then(({ proofs }) => {
        if (!cancelled) setProofs(proofs);
      })
      .catch((err) => {
        if (!cancelled)
          setProofsError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [challengeId]);

  // We own this challenge when our user id matches its creator id. Both are
  // MongoDB ObjectIds serialized to strings, so a plain === works.
  const isOwner =
    userId !== null && challenge !== null && challenge.creator === userId;

  // ---- completion-gate display logic (mirrors the Stage 8 backend rule) ----
  const hasApprovedProof = proofs?.some((p) => p.status === "approved") ?? false;
  // Only assert "blocked" once the proof list has actually loaded — if the
  // list failed, the backend enforces the rule anyway and its message shows.
  const requiresApprovedProof =
    challenge !== null &&
    challenge.proofRequired &&
    challenge.status === "active" &&
    proofs !== null &&
    !hasApprovedProof;

  const runAction = async (next: Challenge["status"]) => {
    if (!token) return;
    setBusy(true);
    setActionError(null);
    try {
      const { challenge: updated } = await updateChallengeStatus(
        token,
        challengeId,
        next
      );
      setChallenge(updated);
    } catch (err) {
      // e.g. the backend rejected an illegal transition — show its message.
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!token) return;
    setBusy(true);
    setActionError(null);
    try {
      await deleteChallenge(token, challengeId);
      onDeleted(); // leave the (now nonexistent) detail view
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const handleSubmitProof = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSubmitBusy(true);
    setProofsActionError(null);
    const images = proofImageUrls
      .map((url) => url.trim())
      .filter((url) => url.length > 0);
    try {
      const { proof } = await submitProof(token, challengeId, {
        content: proofContent.trim(),
        ...(images.length > 0 ? { images } : {}),
      });
      // Newest-first, matching the backend's list ordering.
      setProofs((prev) => [proof, ...(prev ?? [])]);
      setProofContent("");
      setProofImageUrls([""]);
    } catch (err) {
      // e.g. "challenge must be active" — surface the backend's words.
      setProofsActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitBusy(false);
    }
  };

  const handleVerify = async (proofId: string, decision: VerifyDecision) => {
    if (!token) return;
    setVerifyBusyId(proofId);
    setProofsActionError(null);
    try {
      const { proof } = await verifyProof(token, proofId, decision);
      // Swap the updated proof into the list in place.
      setProofs((prev) =>
        (prev ?? []).map((p) => (p._id === proof._id ? proof : p))
      );
    } catch (err) {
      // e.g. "already verified" — surface the backend's words.
      setProofsActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifyBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="text-sm text-zinc-500 underline hover:text-zinc-900"
      >
        &larr; Back to challenges
      </button>

      {loading && <p className="text-sm text-zinc-500">Loading challenge&hellip;</p>}

      {error && (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
      )}

      {challenge !== null && !loading && (
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-zinc-900">
              {challenge.title}
            </h2>
            <span
              className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[challenge.status]}`}
            >
              {STATUS_LABELS[challenge.status]}
            </span>
          </div>

          <p className="mt-2 text-sm text-zinc-700">{challenge.description}</p>

          <div className="mt-3 rounded-md bg-zinc-50 p-3">
            <span className="text-xs font-medium uppercase text-zinc-400">
              Rules
            </span>
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">
              {challenge.rules}
            </p>
          </div>

          <dl className="mt-3 space-y-1.5">
            <Row label="NIM amount" value={`${challenge.nimAmount} NIM`} />
            <Row
              label="Proof required"
              value={challenge.proofRequired ? "Yes" : "No"}
            />
            <Row label="Type" value={challenge.type} />
            <Row
              label="Creator"
              value={
                isOwner
                  ? "You (this wallet)"
                  : shorten(challenge.creator, 24)
              }
            />
            <Row
              label="Starts"
              value={formatDateTime(challenge.startDate)}
            />
            <Row label="Ends" value={formatDateTime(challenge.endDate)} />
            <Row
              label="Created"
              value={formatDateTime(challenge.createdAt)}
            />
          </dl>

          {actionError && (
            <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {actionError}
            </p>
          )}

          {isOwner && challenge.status === "draft" && (
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void runAction("active")}
                disabled={busy}
                className="flex-1 rounded-lg bg-zinc-900 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Saving&hellip;" : "Activate"}
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={busy}
                className="flex-1 rounded-lg bg-red-600 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "Saving&hellip;" : "Delete"}
              </button>
            </div>
          )}

          {isOwner && challenge.status === "active" && (
            <div className="mt-4 space-y-2">
              <div className="flex gap-2">
                <button
                  onClick={() => void runAction("completed")}
                  disabled={busy || requiresApprovedProof}
                  title={
                    requiresApprovedProof
                      ? "Submit and approve a proof first."
                      : undefined
                  }
                  className="flex-1 rounded-lg bg-zinc-900 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "Saving&hellip;" : "Mark Completed"}
                </button>
                <button
                  onClick={() => void runAction("failed")}
                  disabled={busy}
                  className="flex-1 rounded-lg bg-red-600 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy ? "Saving&hellip;" : "Mark Failed"}
                </button>
              </div>
              {requiresApprovedProof && (
                <p className="text-xs text-zinc-500">
                  This challenge requires an approved proof before it can be
                  marked completed.
                  {proofs?.some((p) => p.status === "pending")
                    ? " Your proof is pending — approve it below."
                    : " Submit a proof below, then approve it."}
                </p>
              )}
            </div>
          )}

          {/* ----- Proofs (Stage 9) ----- */}
          <div className="mt-5 border-t border-zinc-100 pt-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                Proofs
              </h3>
              {proofs !== null && (
                <span className="text-xs text-zinc-400">
                  {proofs.length === 1 ? "1 submitted" : `${proofs.length} submitted`}
                </span>
              )}
            </div>

            <p className="mt-2 rounded-md bg-zinc-50 p-2.5 text-xs leading-relaxed text-zinc-500">
              For this MVP, challenge creators verify their own proof
              submissions. Independent verification is planned for a future
              version.
            </p>

            {proofsActionError && (
              <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                {proofsActionError}
              </p>
            )}

            {proofsError && (
              <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                Could not load proofs &mdash; {proofsError}
              </p>
            )}

            {isOwner && challenge.status === "active" && (
              <form
                onSubmit={(e) => void handleSubmitProof(e)}
                className="mt-3 rounded-md border border-zinc-200 p-3"
              >
                <label
                  htmlFor="proof-content"
                  className="text-xs font-medium uppercase text-zinc-400"
                >
                  How did you complete it?
                </label>
                <textarea
                  id="proof-content"
                  value={proofContent}
                  onChange={(e) => setProofContent(e.target.value)}
                  rows={2}
                  placeholder="Describe your evidence (e.g. the screenshot you took)."
                  className="mt-1 w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-800 focus:border-zinc-900 focus:outline-none"
                />

                <span className="mt-2 block text-xs font-medium uppercase text-zinc-400">
                  Image URLs (optional)
                </span>
                {proofImageUrls.map((url, i) => (
                  <div key={i} className="mt-1 flex items-center gap-2">
                    <input
                      value={url}
                      onChange={(e) =>
                        setProofImageUrls((prev) =>
                          prev.map((u, idx) => (idx === i ? e.target.value : u))
                        )
                      }
                      placeholder="https://example.com/photo.png"
                      className="w-full rounded-md border border-zinc-300 px-2 py-1.5 text-sm text-zinc-800 focus:border-zinc-900 focus:outline-none"
                    />
                    {proofImageUrls.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setProofImageUrls((prev) =>
                            prev.filter((_, idx) => idx !== i)
                          )
                        }
                        className="shrink-0 text-xs text-zinc-400 underline hover:text-zinc-700"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {proofImageUrls.length < 5 && (
                  <button
                    type="button"
                    onClick={() => setProofImageUrls((prev) => [...prev, ""])}
                    className="mt-1.5 text-sm text-zinc-500 underline hover:text-zinc-800"
                  >
                    + Add image URL
                  </button>
                )}

                <button
                  type="submit"
                  disabled={submitBusy || proofContent.trim().length === 0}
                  className="mt-3 w-full rounded-lg bg-zinc-900 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitBusy ? "Submitting&hellip;" : "Submit Proof"}
                </button>
              </form>
            )}

            {proofs === null && !proofsError && (
              <p className="mt-3 text-sm text-zinc-500">Loading proofs&hellip;</p>
            )}

            {proofs !== null && proofs.length === 0 && (
              <p className="mt-3 text-sm text-zinc-400">
                {isOwner && challenge.status === "active"
                  ? "No proofs yet — submit one above."
                  : "No proofs submitted yet."}
              </p>
            )}

            {proofs !== null && proofs.length > 0 && (
              <ul className="mt-3 space-y-2">
                {proofs.map((proof) => (
                  <ProofCard
                    key={proof._id}
                    proof={proof}
                    canVerify={isOwner && proof.status === "pending"}
                    verifyBusyId={verifyBusyId}
                    onVerify={(proofId, decision) =>
                      void handleVerify(proofId, decision)
                    }
                  />
                ))}
              </ul>
            )}
          </div>

          {!isOwner && (
            <p className="mt-4 text-xs text-zinc-400">
              Read-only view — you are not the creator of this challenge.
            </p>
          )}
        </div>
      )}
    </div>
  );
}