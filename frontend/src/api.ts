// NimDare frontend API client (Stages 6-7 + proof calls from Stage 9).
//
// A small typed wrapper around fetch() for the backend REST API. Every
// function returns the parsed JSON body on success and throws an Error whose
// message is the backend's own error text (we surface it, we don't swallow
// it), so the UI can show a clear reason instead of a vague "request failed".

import type { ErrorResponse } from "@nimiq/mini-app-sdk";

// Where the backend lives. Vite injects VITE_API_BASE_URL from frontend/.env
// at build time. In dev this must be a LAN address the PHONE can reach
// (e.g. http://192.168.1.100:3001) — NOT localhost, because localhost inside
// Nimiq Pay means the phone itself. We trim a trailing slash and fall back to
// localhost so the app still works when opened in a normal desktop browser.
const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, "") ??
  "http://localhost:3001";

// ---- response shapes (mirror the backend's JSON) ----

export interface User {
  _id: string;
  walletAddress: string;
  username: string;
  profileImage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectResponse {
  user: User;
}

export interface VerifyResponse {
  token: string;
  user: User;
}

export interface MeResponse {
  user: User;
}

// Nimiq provider methods can reject with an { error: { type, message } }
// object instead of the expected payload (e.g. the user dismisses the account
// or signing dialog on their phone). This type guard lets us detect that case
// and turn it into a readable error instead of crashing.
export function isErrorResponse(result: unknown): result is ErrorResponse {
  return (
    typeof result === "object" &&
    result !== null &&
    "error" in result
  );
}

// Core fetch wrapper — all real requests go through here so error handling is
// consistent:
//   - network failure  -> a message telling you the backend wasn't reachable
//   - non-2xx response -> the backend's { error: "..." } message, thrown so
//                          the caller can show it to the user
async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {}
): Promise<T> {
  const { method = "GET", body, token } = options;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        // Sent for protected endpoints like GET /api/me.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    // fetch rejects on network-level failures only (DNS, refused connection,
    // phone can't reach the dev machine, ...).
    throw new Error(
      `Could not reach the backend at ${API_BASE_URL} — is it running, and is ` +
        "VITE_API_BASE_URL set to a URL your phone can actually reach?"
    );
  }

  // Some endpoints (DELETE) answer 204 No Content on purpose — there is no
  // JSON body to read, so return early instead of trying to parse nothing.
  if (res.status === 204) {
    return undefined as T;
  }

  // The backend always replies with JSON. If parsing fails, data stays null
  // and we fall back to reporting the HTTP status.
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    // The backend's error shape is { error: string } — surface that text.
    const backendMessage =
      data !== null &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed with status ${res.status}`;
    throw new Error(backendMessage);
  }

  return data as T;
}

// ---- API functions (one thin wrapper per backend endpoint) ----

// POST /api/auth/connect — tell the backend about our wallet address.
// It finds the user record or creates a new one. No signature yet, no token.
export function connectWallet(walletAddress: string): Promise<ConnectResponse> {
  return apiRequest<ConnectResponse>("/api/auth/connect", {
    method: "POST",
    body: { walletAddress },
  });
}

// POST /api/auth/verify — send the signed login message. The backend checks
// the signature really came from this wallet and hands back { token, user }.
export function verifyLogin(
  walletAddress: string,
  publicKey: string,
  message: string,
  signature: string
): Promise<VerifyResponse> {
  return apiRequest<VerifyResponse>("/api/auth/verify", {
    method: "POST",
    body: { walletAddress, publicKey, message, signature },
  });
}

// GET /api/me — fetch the logged-in user directly from MongoDB (protected
// route). Used to *prove* the login round trip works: the data is not just
// echoed back from the login step, it is read fresh from the database.
export function getMe(token: string): Promise<MeResponse> {
  return apiRequest<MeResponse>("/api/me", { token });
}

// ---- Challenge types (Stage 7) ----

// The only statuses a solo challenge can be in (mirrors the backend model).
export type ChallengeStatus = "draft" | "active" | "completed" | "failed";

// Shape of a Challenge as returned by the backend.
// NOTE: `creator` is a MongoDB ObjectId (serialized to a hex string) — the
// list/detail endpoints do NOT populate the creator's username, so the UI
// displays it as a short id (and can mark it "you" when it matches the
// logged-in user).
export interface Challenge {
  _id: string;
  title: string;
  description: string;
  creator: string;
  type: "solo";
  rules: string;
  proofRequired: boolean;
  nimAmount: number;
  status: ChallengeStatus;
  startDate: string;
  endDate: string;
  createdAt: string;
  updatedAt: string;
}

// The payload accepted by POST /api/challenges. Dates are sent as ISO
// strings; the backend coerces them to Date.
export interface CreateChallengeData {
  title: string;
  description: string;
  rules: string;
  nimAmount: number;
  startDate: string;
  endDate: string;
  proofRequired?: boolean;
}

export interface ChallengeListResponse {
  challenges: Challenge[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Optional filters for GET /api/challenges (status, creator, pagination).
// Only the fields you actually set are sent as query params.
export interface ChallengeListFilters {
  status?: ChallengeStatus;
  creator?: string;
  page?: number;
  limit?: number;
}

// ---- Challenge API functions ----

// POST /api/challenges — create a solo challenge (requires auth).
export function createChallenge(
  token: string,
  data: CreateChallengeData
): Promise<{ challenge: Challenge }> {
  return apiRequest<{ challenge: Challenge }>("/api/challenges", {
    method: "POST",
    body: data,
    token,
  });
}

// GET /api/challenges — list challenges (public), with optional filters and
// pagination. Returns { challenges, total, page, limit, totalPages }.
export function listChallenges(
  filters: ChallengeListFilters = {}
): Promise<ChallengeListResponse> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.creator) params.set("creator", filters.creator);
  if (filters.page !== undefined) params.set("page", String(filters.page));
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));

  const query = params.toString();
  return apiRequest<ChallengeListResponse>(
    `/api/challenges${query ? `?${query}` : ""}`
  );
}

// GET /api/challenges/:id — view one challenge (public).
export function getChallenge(id: string): Promise<{ challenge: Challenge }> {
  return apiRequest<{ challenge: Challenge }>(`/api/challenges/${id}`);
}

// PATCH /api/challenges/:id/status — move a challenge to its next status
// (requires auth + creator). Legit transitions only: the backend rejects
// invalid ones with a clear 400.
export function updateChallengeStatus(
  token: string,
  id: string,
  status: ChallengeStatus
): Promise<{ challenge: Challenge }> {
  return apiRequest<{ challenge: Challenge }>(
    `/api/challenges/${id}/status`,
    { method: "PATCH", body: { status }, token }
  );
}

// DELETE /api/challenges/:id — delete a DRAFT challenge (requires auth +
// creator). The backend answers 204 on success.
export function deleteChallenge(token: string, id: string): Promise<void> {
  return apiRequest<void>(`/api/challenges/${id}`, {
    method: "DELETE",
    token,
  });
}

// ---- Proof types (Stage 9) ----

// The lifecycle of a submitted proof. "pending" is the unverified state; only
// the challenge creator can flip it, and only once (self-verification — the
// UI shows an honest note about that limitation).
export type ProofStatus = "pending" | "approved" | "rejected";

// Shape of a Proof as returned by the backend.
export interface Proof {
  _id: string;
  challenge: string; // the Challenge _id this proof belongs to
  user: string; // the _id of the user who submitted it (the creator)
  content: string;
  images?: string[]; // string URLs only — no file upload
  status: ProofStatus;
  verifiedAt?: string; // set once the creator approved/rejected the proof
  createdAt: string;
  updatedAt: string;
}

// The payload accepted by POST /api/challenges/:challengeId/proofs.
export interface SubmitProofData {
  content: string;
  images?: string[];
}

// The two decisions a creator can make on a pending proof.
export type VerifyDecision = "approved" | "rejected";

// ---- Proof API functions ----

// POST /api/challenges/:challengeId/proofs — the creator submits proof for an
// ACTIVE challenge (requires auth). The backend rejects non-creators, and
// challenges that are draft/completed/failed, with a clear message.
export function submitProof(
  token: string,
  challengeId: string,
  data: SubmitProofData
): Promise<{ proof: Proof }> {
  return apiRequest<{ proof: Proof }>(
    `/api/challenges/${challengeId}/proofs`,
    { method: "POST", body: data, token }
  );
}

// GET /api/challenges/:challengeId/proofs — public, newest first.
export function listProofs(
  challengeId: string
): Promise<{ proofs: Proof[] }> {
  return apiRequest<{ proofs: Proof[] }>(
    `/api/challenges/${challengeId}/proofs`
  );
}

// POST /api/proofs/:proofId/verify — the creator approves/rejects a PENDING
// proof (requires auth). A proof can be verified only once.
export function verifyProof(
  token: string,
  proofId: string,
  decision: VerifyDecision
): Promise<{ proof: Proof }> {
  return apiRequest<{ proof: Proof }>(`/api/proofs/${proofId}/verify`, {
    method: "POST",
    body: { decision },
    token,
  });
}