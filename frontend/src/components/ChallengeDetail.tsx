// Challenge detail view (Stage 7).
//
// Fetches one challenge by id (public GET). If the logged-in user is the
// creator, the right action buttons for the current status are shown and the
// matching backend calls run — the returned challenge replaces the one on
// screen, so the view always reflects server state. Non-creators (and
// logged-out visitors) see the challenge read-only.

import { useEffect, useState } from "react";
import {
  deleteChallenge,
  getChallenge,
  updateChallengeStatus,
  type Challenge,
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
  const [busy, setBusy] = useState(false); // an action is in flight
  const [actionError, setActionError] = useState<string | null>(null);

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

  // We own this challenge when our user id matches its creator id. Both are
  // MongoDB ObjectIds serialized to strings, so a plain === works.
  const isOwner =
    userId !== null && challenge !== null && challenge.creator === userId;

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
            <div className="mt-4 flex gap-2">
              <button
                onClick={() => void runAction("completed")}
                disabled={busy}
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
          )}

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