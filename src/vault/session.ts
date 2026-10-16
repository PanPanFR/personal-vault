// In-memory vault session — DEK, subkeys, token/key, search index live here
// ONLY while unlocked. lock() wipes everything. Nothing here hits disk.
import { wipeKey } from "../crypto/dek";

export const LOCK_TIMEOUT_OPTIONS = [1, 5, 15, 30] as const;
export type LockTimeoutMinutes = (typeof LOCK_TIMEOUT_OPTIONS)[number];
export const LOCK_TIMEOUT_DEFAULT: LockTimeoutMinutes = 5;

export const LOCK_EPOCH_KEY = "pv-lock-epoch";

export interface UnlockedState {
  vaultId: string;
  dek: Uint8Array;
  recEncKey: Uint8Array;
  localCredKey: Uint8Array;
  keyVersion: number;
  /** Raw device token + Ed25519 private key live in memory only while unlocked. */
  deviceToken: Uint8Array | null;
  devicePrivateKey: Uint8Array | null;
  lockTimeoutMinutes: LockTimeoutMinutes;
  lastActivityMs: number;
}

let state: UnlockedState | null = null;

export function isUnlocked(): boolean {
  return state !== null;
}

export function requireUnlocked(): UnlockedState {
  if (!state) throw new Error("VAULT_LOCKED: unlock the vault first.");
  return state;
}

export function getSession(): UnlockedState | null {
  return state;
}

export function setSession(next: UnlockedState): void {
  clearSession();
  state = next;
  touchActivity();
}

/** Wipe DEK/subkeys/token/key from memory + clear lock-epoch. */
export function clearSession(): void {
  if (state) {
    wipeKey(state.dek);
    wipeKey(state.recEncKey);
    wipeKey(state.localCredKey);
    wipeKey(state.deviceToken);
    wipeKey(state.devicePrivateKey);
  }
  state = null;
  try {
    localStorage.removeItem(LOCK_EPOCH_KEY);
  } catch {
    // localStorage may be unavailable (private mode) — memory wipe is the guarantee.
  }
}

/** Record activity; persists ONLY an epoch int in localStorage (no secrets). */
export function touchActivity(now = Date.now()): void {
  if (!state) return;
  state.lastActivityMs = now;
  try {
    localStorage.setItem(LOCK_EPOCH_KEY, String(now));
  } catch {
    // ignore — in-memory timestamp still enforces lock
  }
}

export function isLockTimeout(value: unknown): value is LockTimeoutMinutes {
  return (
    typeof value === "number" &&
    (LOCK_TIMEOUT_OPTIONS as readonly number[]).includes(value)
  );
}

/** Resume check: lock when now - lastActivity >= timeout. Epoch fallback included. */
export function shouldLockOnResume(now = Date.now()): boolean {
  if (!state) return true;
  let last = state.lastActivityMs;
  try {
    const raw = localStorage.getItem(LOCK_EPOCH_KEY);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) last = Math.min(last, parsed);
    }
  } catch {
    // fall through to memory timestamp
  }
  return now - last >= state.lockTimeoutMinutes * 60_000;
}

export function checkResumeLock(now = Date.now()): boolean {
  if (shouldLockOnResume(now)) {
    clearSession();
    return true;
  }
  touchActivity(now);
  return false;
}

/**
 * Settings `lock_timeout` change (pwa plan). Applies to the live session when
 * the vault is unlocked; a locked vault picks the new value up on next unlock.
 */
export function updateLockTimeout(minutes: LockTimeoutMinutes): boolean {
  if (!isLockTimeout(minutes)) return false;
  if (state) state.lockTimeoutMinutes = minutes;
  return true;
}
