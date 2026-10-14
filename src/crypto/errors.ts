// Crypto error type — uses frozen Appendix A codes, never renames them.
// Source: src/lib/errors.ts (frozen), docs/backend/crypto-spec.md §4.3/§7.3.
import type { ErrorCode } from "../lib/errors";

export class CryptoError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message?: string) {
    super(message ? `${code}: ${message}` : code);
    this.name = "CryptoError";
    this.code = code;
  }
}

export function isCryptoError(e: unknown, code?: ErrorCode): e is CryptoError {
  return e instanceof CryptoError && (code === undefined || e.code === code);
}
