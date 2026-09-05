// Challenge list (Stage 7).
//
// Public view — works for logged-out users too. Shows one card per challenge
// (title, status, amount, creator short-id, end date), lets you filter by
// status, and paginates through the backend's `page`/`limit` params. Clicking
// a row reports the challenge id up to the app, which swaps to the detail view.

import { useEffect, useState } from "react";
import { listChallenges, type Challenge, type ChallengeStatus } from "../api";
import { formatDate, shorten } from "../format";

// "all" is a UI-only pseudo-filter; everything else maps straight to the
// backend's ?status= query param.
type StatusFilter = "all" | ChallengeStatus;

const STATUS_FILTERS: StatusFilter[] = [
  "all",
  "draft",
  "active",
  "completed",
  "failed",
];

const STATUS_LABELS: Record<string, string> = {
  all: "All",
  draft: "Draft",
  active: "Active",
  completed: "Completed",
  failed: "Failed",
};

// Tailwind classes for the little status badge, color-coded per status.
const STATUS_BADGE: Record<ChallengeStatus, string> = {
  draft: "bg-zinc-100 text-zinc-700",
  active: "bg-emerald-100 text-emerald-800",
  completed: "bg-sky-100 text-sky-800",
  failed: "bg-red-100 text-red-700",
};

const PAGE_SIZE = 10;

interface ChallengeListProps {
  // Navigate to the challenge detail view for this id.
  onSelect: (id: string) => void;
}

export function ChallengeList({ onSelect }: ChallengeListProps) {
  const [challenges, setChallenges] = useState<Challenge[] | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-fetch whenever the filter or the page changes.
  useEffect(() => {
    let cancelled = false; // ignore results if the effect re-ran meanwhile

    setLoading(true);
    setError(null);

    listChallenges({
      ...(filter === "all" ? {} : { status: filter }),
      page,
      limit: PAGE_SIZE,
    })
      .then((res) => {
        if (cancelled) return;
        setChallenges(res.challenges);
        setTotal(res.total);
        setTotalPages(res.totalPages);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [filter, page]);

  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-zinc-900">Challenges</h2>
        <span className="text-sm text-zinc-400">{total} total</span>
      </div>

      {/* Status filter — choosing one also resets to page 1. */}
      <div className="mt-3 flex flex-wrap gap-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
            className={`rounded px-2 py-1 text-xs font-medium ${
              filter === f
                ? "bg-zinc-900 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {STATUS_LABELS[f]}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading && challenges === null && (
        <p className="mt-3 text-sm text-zinc-500">Loading challenges&hellip;</p>
      )}

      {!loading && challenges !== null && challenges.length === 0 && (
        <p className="mt-3 text-sm text-zinc-500">No challenges here yet.</p>
      )}

      {challenges !== null && challenges.length > 0 && (
        <ul className="mt-3 space-y-2">
          {challenges.map((c) => (
            <li key={c._id}>
              <button
                onClick={() => onSelect(c._id)}
                className="w-full rounded-md border border-zinc-200 p-3 text-left hover:bg-zinc-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium text-zinc-900">
                    {c.title}
                  </span>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[c.status]}`}
                  >
                    {STATUS_LABELS[c.status]}
                  </span>
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {c.nimAmount} NIM &middot; ends {formatDate(c.endDate)} &middot; by{" "}
                  {shorten(c.creator, 10)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Pagination (prev/next). */}
      <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-3">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="rounded bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 enabled:hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Previous
        </button>
        <span className="text-sm text-zinc-500">
          Page {page} of {Math.max(1, totalPages)}
        </span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={page >= totalPages}
          className="rounded bg-zinc-100 px-3 py-1.5 text-sm font-medium text-zinc-700 enabled:hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}