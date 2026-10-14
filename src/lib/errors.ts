// Frozen Appendix A error codes (contract v1). Adding, removing, or renaming
// a code requires a formal contract revision (PRD > api-spec.md > openapi.yaml > code).
export const ERROR_CODES = [
  "VALIDATION_ERROR",
  "CRYPTO_VERSION_UNSUPPORTED",
  "TICKET_INVALID",
  "SYNC_CURSOR_INVALID",
  "DEVICE_UNAUTHORIZED",
  "DEVICE_REVOKED",
  "INVALID_SIGNATURE",
  "STALE_TIMESTAMP",
  "VAULT_NOT_FOUND",
  "REPLAY_DETECTED",
  "REVISION_CONFLICT",
  "VERSION_MISMATCH",
  "TICKET_EXPIRED",
  "TICKET_CONSUMED",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "QUOTA_EXHAUSTED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorDefinition {
  code: ErrorCode;
  httpStatus: number;
  retryable: boolean;
  uiCategory: string;
  message: string;
}

export const ERROR_DEFINITIONS: Record<ErrorCode, ErrorDefinition> = {
  VALIDATION_ERROR: { code: "VALIDATION_ERROR", httpStatus: 400, retryable: false, uiCategory: "Malformed data", message: "The request body fails schema or size validation." },
  CRYPTO_VERSION_UNSUPPORTED: { code: "CRYPTO_VERSION_UNSUPPORTED", httpStatus: 400, retryable: false, uiCategory: "Version mismatch", message: "Argon2id envelope parameters below/above bounds or unknown version." },
  TICKET_INVALID: { code: "TICKET_INVALID", httpStatus: 400, retryable: false, uiCategory: "Malformed data", message: "Pairing ticket hash unknown or invalid." },
  SYNC_CURSOR_INVALID: { code: "SYNC_CURSOR_INVALID", httpStatus: 400, retryable: false, uiCategory: "Malformed data", message: "Cursor value negative or corrupt." },
  DEVICE_UNAUTHORIZED: { code: "DEVICE_UNAUTHORIZED", httpStatus: 401, retryable: false, uiCategory: "Authorization / revocation", message: "Missing or unknown device bearer token." },
  DEVICE_REVOKED: { code: "DEVICE_REVOKED", httpStatus: 401, retryable: false, uiCategory: "Authorization / revocation", message: "Device revoked." },
  INVALID_SIGNATURE: { code: "INVALID_SIGNATURE", httpStatus: 401, retryable: false, uiCategory: "Authorization / revocation", message: "PV-Device signature invalid." },
  STALE_TIMESTAMP: { code: "STALE_TIMESTAMP", httpStatus: 401, retryable: true, uiCategory: "Rate-limited / Clock skew", message: "Request timestamp outside window." },
  VAULT_NOT_FOUND: { code: "VAULT_NOT_FOUND", httpStatus: 404, retryable: false, uiCategory: "Conflict / Not found", message: "Vault not found." },
  REPLAY_DETECTED: { code: "REPLAY_DETECTED", httpStatus: 409, retryable: false, uiCategory: "Conflict", message: "Reused nonce with differing body." },
  REVISION_CONFLICT: { code: "REVISION_CONFLICT", httpStatus: 409, retryable: false, uiCategory: "Conflict", message: "Revision mismatch." },
  VERSION_MISMATCH: { code: "VERSION_MISMATCH", httpStatus: 409, retryable: false, uiCategory: "Version mismatch", message: "Please update the app." },
  TICKET_EXPIRED: { code: "TICKET_EXPIRED", httpStatus: 410, retryable: false, uiCategory: "Conflict", message: "Pairing ticket expired." },
  TICKET_CONSUMED: { code: "TICKET_CONSUMED", httpStatus: 410, retryable: false, uiCategory: "Conflict", message: "Pairing ticket consumed." },
  PAYLOAD_TOO_LARGE: { code: "PAYLOAD_TOO_LARGE", httpStatus: 413, retryable: false, uiCategory: "Malformed data", message: "Payload exceeds cap." },
  RATE_LIMITED: { code: "RATE_LIMITED", httpStatus: 429, retryable: true, uiCategory: "Rate-limited", message: "Too many requests." },
  INTERNAL_ERROR: { code: "INTERNAL_ERROR", httpStatus: 500, retryable: true, uiCategory: "Network / Server failure", message: "Internal error." },
  QUOTA_EXHAUSTED: { code: "QUOTA_EXHAUSTED", httpStatus: 503, retryable: true, uiCategory: "Quota exhaustion", message: "Quota exhausted." },
};

export function isErrorEnvelope(value: unknown): value is { code: ErrorCode; message: string; retryable: boolean } {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.code === "string" &&
    (ERROR_CODES as readonly string[]).includes(v.code) &&
    typeof v.message === "string" &&
    typeof v.retryable === "boolean"
  );
}
