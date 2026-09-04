// Nimiq signature verification (Stage 3).
//
// This module verifies a message signature produced by the Nimiq Pay Mini App
// provider's `sign(message)` method, which returns `{ publicKey, signature }`
// as hex strings. It also verifies that a public key actually corresponds to a
// claimed Nimiq wallet address.
//
// The scheme below is CONFIRMED against official Nimiq sources:
//   - Signatures are Ed25519 (64 bytes). Public keys are 32 bytes.
//   - Message signing uses a "signed message" prefix scheme to stop a wallet
//     from being tricked into signing a transaction:
//         hash = sha256( '\x16Nimiq Signed Message:\n' + <message byte length> + <message> )
//   - A Nimiq address is derived from the public key by hashing the key with
//     Blake2b, taking the first 20 bytes, and encoding them in the Nimiq
//     base32 + IBAN user-friendly format (e.g. "NQ... ...").
//
// Rather than reimplementing Ed25519, SHA-256, Blake2b or the base32/IBAN
// encoding by hand, we delegate to Nimiq's own official Rust-to-WASM library
// (`@nimiq/core`). Using Nimiq's own primitives means the verification is
// guaranteed to match what the wallet produced.

import * as Nimiq from "@nimiq/core";

// The exact byte prefix the Nimiq Keyguard prepends to a message before it is
// hashed and signed. Confirmed from the official Nimiq "Sign Message" docs.
export const NIMIQ_SIGN_PREFIX = "\x16Nimiq Signed Message:\n";

// Shape matching the mini-app provider's `sign()` return value.
export interface NimiqSignatureInput {
  publicKey: string; // hex string, 32 bytes
  signature: string; // hex string, 64 bytes
  message: string; // the exact string that was signed
}

// Computes the 32-byte hash that a message is signed over:
//   sha256( '\x16Nimiq Signed Message:\n' + <byteLength> + <message> )
// The byte length is used (not character count), matching the Nimiq Keyguard.
export function hashNimiqMessage(message: string): Uint8Array {
  const byteLength = Buffer.byteLength(message, "utf8");
  const data = `${NIMIQ_SIGN_PREFIX}${byteLength}${message}`;
  const dataBytes = Nimiq.BufferUtils.fromUtf8(data);
  return Nimiq.Hash.computeSha256(dataBytes);
}

// Returns the user-friendly Nimiq address (e.g. "NQxx ...") derived from a
// public key's hex representation. Uses Nimiq's own `.toAddress()`.
export function publicKeyToAddress(publicKeyHex: string): string {
  const publicKey = Nimiq.PublicKey.fromHex(publicKeyHex);
  return publicKey.toAddress().toUserFriendlyAddress();
}

// Verifies that `signature` was produced by `publicKey` signing `message`,
// using Nimiq's actual Ed25519 scheme (message is prefixed + SHA-256 hashed
// before verification, exactly as the Keyguard does when signing).
//
// Returns true/false. Throws only for malformed input (bad hex / wrong
// length), not for a valid-but-wrong signature.
export function verifyNimiqSignature({
  publicKey,
  signature,
  message,
}: NimiqSignatureInput): boolean {
  const pub = Nimiq.PublicKey.fromHex(publicKey);
  const sig = Nimiq.Signature.fromHex(signature);
  const hash = hashNimiqMessage(message);
  return pub.verify(sig, hash);
}

// Verifies that `publicKey` actually corresponds to the claimed `walletAddress`.
// We derive the address from the public key and compare (normalizing spaces,
// since user-friendly addresses are often displayed grouped in 4s).
export function publicKeyMatchesAddress(
  publicKeyHex: string,
  walletAddress: string
): boolean {
  const normalizedClaimed = walletAddress.replace(/\s+/g, "").toUpperCase();
  const derived = publicKeyToAddress(publicKeyHex).replace(/\s+/g, "").toUpperCase();
  return derived === normalizedClaimed;
}
