/**
 * Record ids. The vault keys on client-generated ids so a save never needs a
 * round trip to the server first.
 */

/**
 * UUIDv4 record id.
 *
 * `crypto.randomUUID` only exists in a secure context; the fallback keeps the
 * vault usable on a plain-http LAN address instead of throwing mid-save.
 */
export function newRecordId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}
