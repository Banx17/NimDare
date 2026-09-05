// NimDare Mini App — wallet login flow (Stage 6).
//
// This component owns two things:
//   1. Connecting to Nimiq Pay (from the Stage 5 scaffold) — shows a boot
//      screen until the provider is injected and consensus + block height are
//      known.
//   2. The wallet login flow — "Connect Wallet" runs the full round trip:
//        listAccounts()  -> POST /api/auth/connect  (find-or-create user)
//        sign(message)   -> POST /api/auth/verify  (signature check + JWT)
//                          -> GET /api/me          (prove login works)
//      The token sits in React state only (in-memory) — persistence across
//      reloads is intentionally NOT done in this stage.
//
// State is plain useState. No framework/store on purpose (Stage 5 kept the
// template framework-free).

import { useEffect, useState } from "react";
import { init, type NimiqProvider } from "@nimiq/mini-app-sdk";
import {
  connectWallet,
  getMe,
  isErrorResponse,
  verifyLogin,
  type User,
} from "./api";

// ----- state types -----

// The Nimiq Pay connection stage (from the Stage 5 scaffold).
type NimiqState =
  | { status: "connecting" }
  | { status: "connected"; consensus: boolean; blockNumber: number }
  | { status: "outside-nimiq-pay"; reason: string };

// The wallet login flow. Each in-progress status matches a step that either
// waits on a phone dialog or on the backend.
type AuthState =
  | { status: "idle" }
  | { status: "connecting" } // listAccounts() -> phone confirmation dialog #1
  | { status: "signing" } // sign(message) -> phone confirmation dialog #2
  | { status: "verifying" } // talking to the backend (connect + verify)
  | { status: "done"; token: string; user: User }
  | { status: "error"; message: string };

// The "who am I?" (/api/me) proof card, loaded after a successful login.
type MeState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; user: User }
  | { status: "error"; message: string };

// ----- login message -----

// The message we ask the user's wallet to sign, then send to the backend for
// verification.
//
// Design choice: this is a FIXED string that includes the wallet address.
//   - A timestamp/nonce would harden against replay attacks, BUT the backend
//     (Stage 3) does not track nonces — it only verifies the signature over
//     whatever message it is given. A nonce we cannot validate server-side
//     would add complexity without real security, so we skip it here and note
//     it as a later hardening step (it requires backend changes).
//   - Including the address keeps the signature bound to one specific wallet
//     and makes the Nimiq Pay signing dialog self-describing for the user.
function buildLoginMessage(walletAddress: string): string {
  return `NimDare: login as ${walletAddress}`;
}

export default function App() {
  const [nimiq, setNimiq] = useState<NimiqState>({ status: "connecting" });
  const [provider, setProvider] = useState<NimiqProvider | null>(null);
  const [auth, setAuth] = useState<AuthState>({ status: "idle" });
  const [me, setMe] = useState<MeState>({ status: "idle" });

  // Boot: wait for Nimiq Pay to inject the provider, then probe the network.
  // (Stage 5 scaffold, kept as-is.)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const nimiqProvider = await init({ timeout: 10_000 });
        if (cancelled) return;
        // Keep the provider around so the login handler below can call
        // listAccounts() / sign() later, on button click.
        setProvider(nimiqProvider);

        const [consensus, blockNumber] = await Promise.all([
          nimiqProvider.isConsensusEstablished(),
          nimiqProvider.getBlockNumber(),
        ]);
        if (!cancelled) {
          setNimiq({ status: "connected", consensus, blockNumber });
        }
      } catch (err) {
        if (!cancelled) {
          setNimiq({
            status: "outside-nimiq-pay",
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // GET /api/me with the stored token. Purely visual proof that the round
  // trip works: the user it returns is read fresh from MongoDB, not echoed
  // from the login response.
  const refreshMe = async (token: string) => {
    setMe({ status: "loading" });
    try {
      const { user } = await getMe(token);
      setMe({ status: "ok", user });
    } catch (err) {
      setMe({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // The full login flow. Triggered by the "Connect Wallet" button.
  const handleConnect = async () => {
    // The button is only rendered once connected, but guard anyway so the
    // handler never runs with a missing provider.
    if (!provider) {
      setAuth({ status: "error", message: "Not connected to Nimiq Pay yet." });
      return;
    }

    setAuth({ status: "connecting" });

    try {
      // a. Ask Nimiq Pay which account to use.
      //    -> phone confirmation dialog #1 (expected!)
      const accounts = await provider.listAccounts();
      if (isErrorResponse(accounts)) {
        // The user dismissed the dialog, or access was denied.
        throw new Error(accounts.error.message || "Account access was denied.");
      }
      const walletAddress = accounts[0];
      if (!walletAddress) {
        throw new Error("Your wallet returned no account to log in with.");
      }

      // b. Make sure a User record exists on the backend (find-or-create).
      await connectWallet(walletAddress);

      // c. Build the message this wallet must sign.
      const message = buildLoginMessage(walletAddress);

      // d. Ask the wallet to sign the message.
      //    -> phone confirmation dialog #2 (expected!)
      setAuth({ status: "signing" });
      const signed = await provider.sign(message);
      if (isErrorResponse(signed)) {
        // The user rejected the signature prompt.
        throw new Error(
          signed.error.message || "The signature was not provided."
        );
      }

      // e. Send everything to the backend. It verifies the signature + key
      //    against the claimed address and hands back { token, user }.
      setAuth({ status: "verifying" });
      const { token, user } = await verifyLogin(
        walletAddress,
        signed.publicKey,
        message,
        signed.signature
      );

      // f. Logged in. Token kept in memory for this session only.
      setAuth({ status: "done", token, user });

      // g. Kick off the /api/me proof (non-blocking — the login card already
      //    shows the user; this card updates when the server answers).
      void refreshMe(token);
    } catch (err) {
      // Any step failed (dialog rejected, backend down, verification failed)
      // -> show a clear message and let the user retry.
      setAuth({
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // ----- render -----

  if (nimiq.status === "connecting") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <p className="text-lg text-zinc-600">Connecting to Nimiq Pay&hellip;</p>
      </div>
    );
  }

  if (nimiq.status === "outside-nimiq-pay") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold text-zinc-900">
            Not available in this browser
          </h1>
          <p className="mt-2 text-zinc-500">
            NimDare is a Nimiq Mini App and must be opened inside Nimiq Pay.
            Please open this URL in the Nimiq Pay in-app browser to use the
            app.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm space-y-4">
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <h1 className="text-xl font-semibold text-zinc-900">Nimiq connected</h1>
          <dl className="mt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-500">Consensus established</dt>
              <dd className="font-medium text-zinc-900">
                {nimiq.consensus ? "Yes" : "No"}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-500">Current block</dt>
              <dd className="font-mono text-zinc-900">
                {nimiq.blockNumber.toLocaleString()}
              </dd>
            </div>
          </dl>
        </div>

        {auth.status === "done" ? (
          <>
            {/* Logged in — the identity the backend knows us as. */}
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <h2 className="font-semibold text-zinc-900">Logged in</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-zinc-500">Username</dt>
                  <dd className="truncate font-medium text-zinc-900">
                    {auth.user.username}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-zinc-500">Wallet</dt>
                  <dd className="truncate font-mono text-xs text-zinc-700">
                    {auth.user.walletAddress}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-zinc-500">JWT</dt>
                  <dd className="truncate font-mono text-xs text-zinc-500">
                    {auth.token.slice(0, 20)}&hellip;
                  </dd>
                </div>
              </dl>
            </div>

            {/* /api/me proof — fresh from MongoDB, not echoed from login. */}
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-zinc-900">Who am I? (/api/me)</h2>
                <button
                  onClick={() => void refreshMe(auth.token)}
                  disabled={me.status === "loading"}
                  className="text-sm text-zinc-500 underline enabled:hover:text-zinc-900 disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>

              {me.status === "loading" && (
                <p className="mt-3 text-sm text-zinc-500">
                  Fetching your profile from the backend&hellip;
                </p>
              )}

              {me.status === "ok" && (
                <dl className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Username</dt>
                    <dd className="truncate font-medium text-zinc-900">
                      {me.user.username}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Wallet</dt>
                    <dd className="truncate font-mono text-xs text-zinc-700">
                      {me.user.walletAddress}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">MongoDB _id</dt>
                    <dd className="truncate font-mono text-xs text-zinc-500">
                      {me.user._id}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-zinc-500">Created at</dt>
                    <dd className="truncate font-mono text-xs text-zinc-500">
                      {me.user.createdAt}
                    </dd>
                  </div>
                </dl>
              )}

              {me.status === "error" && (
                <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                  {me.message}
                </p>
              )}
            </div>
          </>
        ) : (
          /* Not logged in — the connect button + status. */
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <h2 className="font-semibold text-zinc-900">Connect your wallet</h2>
            <p className="mt-1 text-sm text-zinc-500">
              You will see confirmation dialogs in Nimiq Pay — first for
              account access, then for signing your login message.
            </p>

            {auth.status === "error" && (
              <p className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                {auth.message}
              </p>
            )}

            <button
              onClick={() => void handleConnect()}
              disabled={auth.status !== "idle"}
              className="mt-4 w-full rounded-lg bg-zinc-900 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {auth.status === "idle" && "Connect Wallet"}
              {auth.status === "connecting" && "Requesting account access&hellip;"}
              {auth.status === "signing" && "Waiting for your signature&hellip;"}
              {auth.status === "verifying" && "Verifying with the backend&hellip;"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}