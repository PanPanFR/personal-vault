import { json, errorResponse, bytesLength, readJsonBody, type PagesFunction } from "../../_shared/http";
import { checkRateLimit, rateLimitedResponse } from "../../_shared/rate-limit";
import { isVaultId, isUuidV4, isSha256Hex } from "../../_shared/crypto";
import {
  validateMasterEnvelope,
  validateRecoveryEnvelope,
} from "../../_shared/validate";

export const onRequestPost: PagesFunction<any> = async (context) => {
  const request = context.request;
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "127.0.0.1";

  const rl = await checkRateLimit(context.env, "vault-create", ip, 3, 3600);
  if (rl.limited) {
    return rateLimitedResponse(rl.retryAfter!);
  }

  const parsed = await readJsonBody(request);
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

  if (body.crypto_format_version !== 1 || body.key_version !== 1 || body.schema_version !== 1) {
    return errorResponse(
      "VERSION_MISMATCH",
      "Version mismatch: crypto_format_version=1, key_version=1, schema_version=1 required.",
      409,
      false,
    );
  }

  const masterErr = validateMasterEnvelope(body.master_envelope);
  if (masterErr) {
    return errorResponse(
      "CRYPTO_VERSION_UNSUPPORTED",
      `Invalid master envelope: ${masterErr}`,
      400,
      false,
    );
  }

  const recErr = validateRecoveryEnvelope(body.recovery_envelope);
  if (recErr) {
    return errorResponse(
      "CRYPTO_VERSION_UNSUPPORTED",
      `Invalid recovery envelope: ${recErr}`,
      400,
      false,
    );
  }

  if (
    typeof body.recovery_auth_verifier !== "string" ||
    body.recovery_auth_verifier.length === 0
  ) {
    return errorResponse(
      "VALIDATION_ERROR",
      "recovery_auth_verifier must be a non-empty string.",
      400,
      false,
    );
  }

  const dev = body.device;
  if (!dev || typeof dev !== "object") {
    return errorResponse(
      "VALIDATION_ERROR",
      "device field is required.",
      400,
      false,
    );
  }

  if (!isUuidV4(dev.device_id)) {
    return errorResponse(
      "VALIDATION_ERROR",
      "device.device_id must be a UUIDv4.",
      400,
      false,
    );
  }

  if (!isSha256Hex(dev.device_token_hash)) {
    return errorResponse(
      "VALIDATION_ERROR",
      "device.device_token_hash must be a 64-character SHA-256 hex string.",
      400,
      false,
    );
  }

  if (typeof dev.device_public_key !== "string" || dev.device_public_key.length === 0) {
    return errorResponse(
      "VALIDATION_ERROR",
      "device.device_public_key must be a non-empty base64url string.",
      400,
      false,
    );
  }

  const label =
    typeof dev.label === "string" && dev.label.trim().length > 0
      ? dev.label.trim()
      : `Device-${dev.device_id.slice(0, 4).toUpperCase()}`;

  const now = new Date().toISOString();
  const me = body.master_envelope;
  const re = body.recovery_envelope;

  try {
    const existing = await context.env.DB.prepare(
      `SELECT vault_id FROM vaults WHERE vault_id = ?`,
    )
      .bind(body.vault_id)
      .first();

    if (existing) {
      return errorResponse(
        "REPLAY_DETECTED",
        "Vault ID already exists.",
        409,
        false,
      );
    }

    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO vaults (
          vault_id, crypto_format_version, kdf_version, salt, kdf_m_kib, kdf_t, kdf_p,
          master_nonce, master_wrapped_dek, master_key_version,
          recovery_crypto_format_version, recovery_key_version, recovery_nonce,
          recovery_wrapped_dek, recovery_auth_verifier, current_change_seq,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      ).bind(
        body.vault_id,
        me.crypto_format_version,
        me.kdf_version,
        me.salt_b64u,
        me.argon2_m_kib,
        me.argon2_t,
        me.argon2_p,
        me.nonce_b64u,
        me.wrapped_dek_b64u,
        me.key_version,
        re.crypto_format_version,
        re.key_version,
        re.nonce_b64u,
        re.wrapped_dek_b64u,
        body.recovery_auth_verifier,
        now,
        now,
      ),
      context.env.DB.prepare(
        `INSERT INTO authorized_devices (
          vault_id, device_id, token_hash, public_key, label, created_at, last_used_at, revoked_at, last_ack_cursor
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      ).bind(
        body.vault_id,
        dev.device_id,
        dev.device_token_hash,
        dev.device_public_key,
        label,
        now,
        now,
      ),
    ]);

    return json(
      {
        vault_id: body.vault_id,
        device_id: dev.device_id,
        created_at: now,
      },
      201,
    );
  } catch (err: any) {
    return errorResponse(
      "INTERNAL_ERROR",
      "Failed to create vault in database.",
      500,
      true,
    );
  }
};
