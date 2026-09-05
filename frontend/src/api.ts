// NimDare frontend API client (Stage 6).
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