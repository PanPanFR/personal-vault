export const PLAINTEXT_ITEM_CAP_BYTES = 256 * 1024;
export const CIPHERTEXT_RECORD_CAP_BYTES = 384 * 1024;
export const SYNC_BATCH_MAX_MUTATIONS = 50;
export const SYNC_BATCH_MAX_BYTES = 1 * 1024 * 1024;
export const PAIRING_TICKET_TTL_SECONDS = 300;
export const REQUEST_CLOCK_SKEW_SECONDS = 300;
export const REQUEST_CLOCK_SKEW_MS = REQUEST_CLOCK_SKEW_SECONDS * 1000;
export const TAG_MAX_PER_ITEM = 20;
export const TAG_MAX_LENGTH = 64;
export const PASSPHRASE_MIN_LENGTH = 8;
export const LOCK_TIMEOUT_DEFAULT_MINUTES = 5;

export const RECOVERY_KIT_FILENAME = "personal-vault-recovery-kit.json";
export const EXPORT_FILENAME_PREFIX = "personal-vault-export-";
export function exportFilename(date: Date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${EXPORT_FILENAME_PREFIX}${yyyy}${mm}${dd}.json`;
}
