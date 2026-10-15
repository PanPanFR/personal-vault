/**
 * iOS ITP eviction handling (PRD §5 G11, pwa-operational §2.4).
 *
 * WebKit may purge IndexedDB, Cache API and localStorage after ~7 days without
 * an open app. The app must never render a half-vault: if the local vault
 * metadata is gone while the shell is alive, we are on a clean start and must
 * offer pairing / recovery-kit restore / new vault.
 */
import type { PersonalVaultDB } from "../db/dexie-schema";

export type StorageState = "intact" | "evicted" | "unavailable";

export interface EvictionCheck {
  state: StorageState;
  /** True when a previous vault clearly existed (vault-id marker in localStorage). */
  hadVaultBefore: boolean;
  reason: "ok" | "metadata-missing" | "db-unavailable";
}

const VAULT_PRESENCE_KEY = "pv-vault-present";

/** Marked on every successful setup/unlock so eviction can be distinguished. */
export function markVaultPresent(vaultId: string | null): void {
  try {
    if (vaultId) localStorage.setItem(VAULT_PRESENCE_KEY, vaultId);
    else localStorage.removeItem(VAULT_PRESENCE_KEY);
  } catch {
    // localStorage unavailable (private mode): detection degrades to metadata-only.
  }
}

export function hadVaultMarker(): boolean {
  try {
    return localStorage.getItem(VAULT_PRESENCE_KEY) !== null;
  } catch {
    return false;
  }
}

export function clearVaultPresence(): void {
  try {
    localStorage.removeItem(VAULT_PRESENCE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Read-only probe. Never writes, so it is safe to run on every boot.
 */
export async function detectStorageEviction(db: PersonalVaultDB): Promise<EvictionCheck> {
  const hadVaultBefore = hadVaultMarker();
  let metadata: unknown;
  try {
    metadata = await db.app_metadata.get("vault");
  } catch {
    // IndexedDB blocked or the database was deleted under us (ITP / devtools).
    return { state: "unavailable", hadVaultBefore, reason: "db-unavailable" };
  }
  if (!metadata) {
    return { state: "evicted", hadVaultBefore, reason: "metadata-missing" };
  }
  return { state: "intact", hadVaultBefore, reason: "ok" };
}

export function shouldShowCleanStart(check: EvictionCheck): boolean {
  // A first-ever launch (nothing cached, no prior vault) is onboarding, not eviction.
  if (check.state === "intact") return false;
  return check.hadVaultBefore || check.state === "evicted";
}