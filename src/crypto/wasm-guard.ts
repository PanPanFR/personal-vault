// libsodium-wrappers-sumo loader with fatal WASM gate.
// PRD §2(11), crypto-spec §2.2: if WASM fails, app must halt with full-screen
// block and refuse ALL vault ops. Never fall back to unencrypted/JS crypto.
import { CryptoError } from "./errors";

let readyPromise: Promise<typeof import("libsodium-wrappers-sumo").default> | null = null;
let failed = false;
let failureMessage = "";

export const WASM_FATAL_MESSAGE =
  "Your browser or security policy does not support required cryptographic primitives. Personal Vault cannot operate.";

export function isCryptoFailed(): boolean {
  return failed;
}

export function cryptoFailureMessage(): string {
  return failureMessage || WASM_FATAL_MESSAGE;
}

/** Reset gate state (tests only). */
export function __resetWasmGate(): void {
  readyPromise = null;
  failed = false;
  failureMessage = "";
}

/** Force the gate into failed state (tests / blocked-WASM simulation). */
export function __forceWasmFailure(message = WASM_FATAL_MESSAGE): void {
  failed = true;
  failureMessage = message;
  readyPromise = Promise.reject(new CryptoError("INTERNAL_ERROR", message));
  // Avoid unhandled rejection noise; callers observe via ensureSodium().
  readyPromise.catch(() => {});
}

export async function ensureSodium(): Promise<typeof import("libsodium-wrappers-sumo").default> {
  if (failed) {
    throw new CryptoError("INTERNAL_ERROR", failureMessage || WASM_FATAL_MESSAGE);
  }
  if (!readyPromise) {
    readyPromise = (async () => {
      try {
        const mod = await import("libsodium-wrappers-sumo");
        const sodium = mod.default;
        await sodium.ready;
        if (!sodium.crypto_aead_xchacha20poly1305_ietf_encrypt || !sodium.crypto_pwhash) {
          throw new Error("libsodium sumo symbols missing");
        }
        return sodium;
      } catch (e) {
        failed = true;
        failureMessage = e instanceof Error ? e.message : String(e);
        throw new CryptoError("INTERNAL_ERROR", WASM_FATAL_MESSAGE);
      }
    })();
  }
  return readyPromise;
}

/** True when crypto loaded and gate open. Vault ops must check this first. */
export async function isCryptoReady(): Promise<boolean> {
  try {
    await ensureSodium();
    return !failed;
  } catch {
    return false;
  }
}
