// Small display helpers shared by several components. Kept deliberately tiny
// so components stay readable without duplicating these one-liners.

// Shortens long identifiers (wallet addresses, Mongo ids) for tight layouts.
// The full value is still available via a `title` attribute when needed.
export function shorten(value: string, maxChars = 18): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, maxChars)}…`;
}

// Formats an ISO date string (as returned by the backend) the way the user's
// phone shows dates, e.g. "9/5/2026, 10:30:00 AM".
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

// Same as formatDateTime but drops the time-of-day for compact lists.
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}