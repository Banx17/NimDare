// NimDare Mini App — wallet login (Stage 6) + challenge views (Stage 7).
//
// This component owns:
//   1. Connecting to Nimiq Pay (Stage 5 scaffold) — boot screen until the
//      provider is injected and consensus + block height are known.
//   2. The wallet login flow (Stage 6) — listAccounts() -> sign(message) ->
//      backend verify -> in-memory JWT + the /api/me proof.
//   3. View switching (Stage 7) — the app shows either the challenge list
//      (with a create-challenge form when logged in) or a challenge detail.
//      Navigation is plain React state: "which challenge id is open?" — no
//      router, on purpose (a router can be added later if it earns its keep).
//
// State is plain useState. No framework/store/schema library.

import { useEffect, useState } from "react";
import { init, type NimiqProvider } from "@nimiq/mini-app-sdk";
import {
  connectWallet,
  getMe,
  isErrorResponse,
  verifyLogin,
  type User,
} from "./api";
import { ChallengeList } from "./components/ChallengeList";
import { ChallengeDetail } from "./components/ChallengeDetail";
import { CreateChallengeForm } from "./components/CreateChallengeForm";
import { shorten } from "./format";

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

// Which screen is shown. Simple state-based navigation: the detail view
// stores the id of the challenge being viewed; the list view is the default.
type View =
  | { name: "list" }
  | { name: "detail"; challengeId: string };

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
  const [view, setView] = useState<View>({ name: "list" });

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

  // GET /api/me with the stored token. Compact proof that the round trip
  // works: the user it returns is read fresh from MongoDB, not echoed from
  // the login response.
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

      // g. Kick off the /api/me proof (non-blocking — updates the header).
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
        {/* Network status (Stage 5 scaffold). */}
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
          /* Logged in — compact identity + the /api/me proof. */
          <div className="rounded-lg bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-zinc-900">Logged in</h2>
                <p className="truncate text-sm text-zinc-600">
                  {auth.user.username}
                  <span
                    className="ml-2 font-mono text-xs text-zinc-400"
                    title={auth.user.walletAddress}
                  >
                    {shorten(auth.user.walletAddress)}
                  </span>
                </p>
              </div>
              <button
                onClick={() => void refreshMe(auth.token)}
                disabled={me.status === "loading"}
                className="shrink-0 text-sm text-zinc-500 underline enabled:hover:text-zinc-900 disabled:opacity-50"
              >
                Who am I?
              </button>
            </div>

            {me.status === "loading" && (
              <p className="mt-2 text-sm text-zinc-500">
                Fetching profile from MongoDB&hellip;
              </p>
            )}
            {me.status === "ok" && (
              <p className="mt-2 text-sm text-zinc-500">
                Server profile:{" "}
                <span className="font-mono text-xs" title={me.user._id}>
                  {shorten(me.user._id, 32)}
                </span>
              </p>
            )}
            {me.status === "error" && (
              <p className="mt-2 text-sm text-red-700">{me.message}</p>
            )}
          </div>
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

        {/* The current screen: challenge list (with create form) or detail. */}
        {view.name === "detail" ? (
          <ChallengeDetail
            challengeId={view.challengeId}
            token={auth.status === "done" ? auth.token : null}
            userId={auth.status === "done" ? auth.user._id : null}
            onBack={() => setView({ name: "list" })}
            onDeleted={() => setView({ name: "list" })}
          />
        ) : (
          <>
            {/* Create-form — only when logged in. */}
            {auth.status === "done" && (
              <CreateChallengeForm
                token={auth.token}
                onCreated={(challenge) =>
                  setView({ name: "detail", challengeId: challenge._id })
                }
              />
            )}

            {/* The list is public — visible logged out too. */}
            <ChallengeList
              onSelect={(challengeId) =>
                setView({ name: "detail", challengeId })
              }
            />
          </>
        )}
      </div>
    </div>
  );
}