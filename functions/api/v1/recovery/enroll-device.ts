import { json, errorResponse, readJsonBody, type PagesFunction } from "../../../_shared/http";
import { checkRateLimit, rateLimitedResponse } from "../../../_shared/rate-limit";
import {
  sha256Hex,
  randomTokenBase64Url,
  isVaultId,
  isUuidV4,
  base64UrlDecode,
} from "../../../_shared/crypto";

/**
 * Count consecutive failed recovery-auth attempts for this vault inside the
 * current hourly window. Stored in the shared rate_limits table under a
 * dedicated scope so it needs no extra migration.
 */
async function getRecoveryFailureCount(env: any, vaultId: string): Promise<number> {
  try {
    const now = Date.now();
    const windowStart = Math.floor(now / 3_600_000) * 3_600_000;
    const row = await env.DB.prepare(
      `SELECT count FROM rate_limits WHERE scope = ? AND bucket_key = ? AND window_start = ?`,
    )
      .bind("recovery-enroll-failures", vaultId, windowStart)
      .first();
    return (row?.count as number) || 0;
  } catch {
    return 0;
  }
}

async function recordRecoveryFailure(env: any, vaultId: string): Promise<void> {
  try {
    const now = Date.now();
    const windowStart = Math.floor(now / 3_600_000) * 3_600_000;
    await env.DB.prepare(
      `INSERT INTO rate_limits (scope, bucket_key, window_start, count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(scope, bucket_key, window_start) DO UPDATE SET count = count + 1`,
    )
      .bind("recovery-enroll-failures", vaultId, windowStart)
      .run();
  } catch {
    // best-effort
  }
}

async function clearRecoveryFailures(env: any, vaultId: string): Promise<void> {
  try {
    const now = Date.now();
    const windowStart = Math.floor(now / 3_600_000) * 3_600_000;
    await env.DB.prepare(
      `DELETE FROM rate_limits WHERE scope = ? AND bucket_key = ? AND window_start = ?`,
    )
      .bind("recovery-enroll-failures", vaultId, windowStart)
      .run();
  } catch {
    // best-effort
  }
}

export const onRequestPost: PagesFunction<any> = async (context) => {
  const parsed = await readJsonBody(context.request);
  if (!parsed.ok) return parsed.response;
  const body: any = parsed.value;

  if (!body || typeof body !== "object") {
    return errorResponse(
      "VALIDATION_ERROR",
      "Request body must be a JSON object.",
      400,
      false,
    );
  }

  if (!isVaultId(body.vault_id)) {
    return errorResponse(
      "VALIDATION_ERROR",
      "vault_id must be a 26-character ULID string.",
      400,
      false,
    );
  }

  if (
    typeof body.recovery_auth_token !== "string" ||
    body.recovery_auth_token.length === 0
  ) {
    return errorResponse(
      "VALIDATION_ERROR",
      "recovery_auth_token must be a non-empty string.",
      400,
      false,
    );
  }

  if (!isUuidV4(body.device_id)) {
    return errorResponse(
      "VALIDATION_ERROR",
      "device_id must be a valid UUIDv4.",
      400,
      false,
    );
  }

  if (
    typeof body.device_public_key !== "string" ||
    body.device_public_key.length === 0
  ) {
    return errorResponse(
      "VALIDATION_ERROR",
      "device_public_key must be a non-empty base64url string.",
      400,
      false,
    );
  }

  const vaultId = body.vault_id;

  // Rate limit: 5 per vault per hour. After 3 consecutive failed attempts the
  // effective budget halves each time further (doubling backoff, api-spec 4
  // row 4 / 6.9) so guessing recovery_auth_token gets progressively slower.
  const failures = await getRecoveryFailureCount(context.env, vaultId);
  const backoffFactor = failures >= 3 ? Math.pow(2, failures - 3) : 1;
  const effectiveLimit = Math.max(1, Math.floor(5 / backoffFactor));

  const rl = await checkRateLimit(
    context.env,
    "recovery-enroll",
    vaultId,
    effectiveLimit,
    3600,
  );
  if (rl.limited) {
    return rateLimitedResponse(rl.retryAfter!);
  }

  try {
    const vault: any = await context.env.DB.prepare(
      `SELECT recovery_auth_verifier, recovery_crypto_format_version,
              recovery_key_version, recovery_nonce, recovery_wrapped_dek
       FROM vaults
       WHERE vault_id = ?`,
    )
      .bind(vaultId)
      .first();

    // Uniform oracle: an unknown vault must be indistinguishable from a bad
    // recovery token on this unauthenticated route, otherwise a caller holding
    // only a vault_id learns which ULIDs are real (api-spec 3.2).
    if (!vault) {
      return errorResponse(
        "DEVICE_UNAUTHORIZED",
        "Recovery authorization token mismatch.",
        401,
        false,
      );
    }

    let authBytes: Uint8Array;
    try {
      authBytes = base64UrlDecode(body.recovery_auth_token);
      if (authBytes.length !== 32) {
        authBytes = new TextEncoder().encode(body.recovery_auth_token);
      }
    } catch {
      authBytes = new TextEncoder().encode(body.recovery_auth_token);
    }

    const providedVerifier = await sha256Hex(authBytes);
    if (providedVerifier !== vault.recovery_auth_verifier) {
      await recordRecoveryFailure(context.env, vaultId);
      return errorResponse(
        "DEVICE_UNAUTHORIZED",
        "Recovery authorization token mismatch.",
        401,
        false,
      );
    }

    await clearRecoveryFailures(context.env, vaultId);

    const rawToken = randomTokenBase64Url(32);
    const tokenHash = await sha256Hex(rawToken);
    const nowIso = new Date().toISOString();
    const label =
      typeof body.label === "string" && body.label.trim().length > 0
        ? body.label.trim()
        : `Device-${body.device_id.slice(0, 4).toUpperCase()}`;

    await context.env.DB.prepare(
      `INSERT INTO authorized_devices (
        vault_id, device_id, token_hash, public_key, label, created_at, last_used_at, revoked_at, last_ack_cursor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
    )
      .bind(
        vaultId,
        body.device_id,
        tokenHash,
        body.device_public_key,
        label,
        nowIso,
        nowIso,
      )
      .run();

    const recoveryEnvelope = {
      crypto_format_version: vault.recovery_crypto_format_version,
      key_version: vault.recovery_key_version,
      nonce_b64u: vault.recovery_nonce,
      wrapped_dek_b64u: vault.recovery_wrapped_dek,
    };

    return json(
      {
        vault_id: vaultId,
        device_id: body.device_id,
        device_token: rawToken,
        recovery_envelope: recoveryEnvelope,
        created_at: nowIso,
      },
      201,
    );
  } catch {
    return errorResponse(
      "INTERNAL_ERROR",
      "Failed to enroll device via recovery in database.",
      500,
      true,
    );
  }
};
