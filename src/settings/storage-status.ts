/**
 * Storage durability status (pwa-operational §2.1, §3.4).
 *
 * Browser storage is a Tier-3 cache, never a backup: the UI only reports what
 * the browser actually granted, and `navigator.storage.persist()` is requested
 * during setup so eviction pressure is reduced (it can still be denied).
 */

export interface StorageStatus {
  /** Persistent storage granted by the browser (best-effort, may be false). */
  persisted: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
  /** 0..100, null when the estimate API is unavailable. */
  usagePercent: number | null;
  /** Local writes are failing (QuotaExceededError path). */
  quotaExceeded: boolean;
}

export const UNKNOWN_STORAGE_STATUS: StorageStatus = {
  persisted: false,
  usageBytes: null,
  quotaBytes: null,
  usagePercent: null,
  quotaExceeded: false,
};

function storageManager(): StorageManager | null {
  if (typeof navigator === "undefined" || !navigator.storage) return null;
  return navigator.storage;
}

export async function readStorageStatus(): Promise<StorageStatus> {
  const manager = storageManager();
  if (!manager) return UNKNOWN_STORAGE_STATUS;

  let persisted = false;
  try {
    persisted = typeof manager.persisted === "function" ? await manager.persisted() : false;
  } catch {
    persisted = false;
  }

  let usageBytes: number | null = null;
  let quotaBytes: number | null = null;
  let usagePercent: number | null = null;
  if (typeof manager.estimate === "function") {
    try {
      const estimate = await manager.estimate();
      usageBytes = typeof estimate.usage === "number" ? estimate.usage : null;
      quotaBytes = typeof estimate.quota === "number" ? estimate.quota : null;
      usagePercent =
        usageBytes !== null && quotaBytes ? Math.min(100, (usageBytes / quotaBytes) * 100) : null;
    } catch {
      // estimate() can throw in private mode; keep the nulls honest.
    }
  }

  return { persisted, usageBytes, quotaBytes, usagePercent, quotaExceeded: false };
}

/** Request durable storage. Returns whether the browser granted it. */
export async function requestPersistentStorage(): Promise<boolean> {
  const manager = storageManager();
  if (!manager || typeof manager.persist !== "function") return false;
  try {
    return await manager.persist();
  } catch {
    return false;
  }
}

export function isQuotaExceededError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name ?? "";
  const message = (error as { message?: string }).message ?? "";
  return (
    name === "QuotaExceededError" ||
    /quota/i.test(message) ||
    /storage (?:is )?full|out of quota/i.test(message)
  );
}

/** Human-readable byte size for the Settings storage card. */
export function formatBytes(bytes: number | null, locale = "en"): string {
  if (bytes === null || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = value >= 10 || Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
  const number = new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US").format(Number(formatted));
  return `${number} ${units[unit]}`;
}