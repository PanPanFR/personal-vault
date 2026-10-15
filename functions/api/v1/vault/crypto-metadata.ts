import { json, errorResponse, type PagesFunction, bytesLength, MAX_JSON_BODY_BYTES } from "../../../_shared/http";
import { authenticate } from "../../../_shared/auth";
import { checkRateLimit, rateLimitedResponse } from "../../../_shared/rate-limit";
import {
  validateMasterEnvelope,
  validateRecoveryEnvelope,
} from "../../../_shared/validate";

export const onRequestPut: PagesFunction<any> = async (context) => {
  const url = new URL(context.request.url);
  const rawBody = await context.request.text();
  if (bytesLength(rawBody) > MAX_JSON_BODY_BYTES) {
    return errorResponse(
      "PAYLOAD_TOO_LARGE",
      "Request body exceeds 1 MiB limit.",
      413,
      false,
    );
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return errorResponse(
      "VALIDATION_ERROR",
      "Request body is not valid JSON.",
      400,
      false,
    );
  }

  if (!body || typeof body !== "object") {
    return errorResponse(
      "VALIDATION_ERROR",
      "Request body must be a JSON object.",
      400,
      false,
    );
  }

  if (body.expected_crypto_format_version !== 1) {
    return errorResponse(
      "VALIDATION_ERROR",
      "expected_crypto_format_version must be 1.",
      400,
      false,
    );
  }

  if (
    !Number.isInteger(body.expected_key_version) ||
    body.expected_key_version < 1
  ) {
    return errorResponse(
      "VALIDATION_ERROR",
      "expected_key_version must be an integer >= 1.",
      400,
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

  if (body.recovery_envelope !== null && body.recovery_envelope !== undefined) {
    const recErr = validateRecoveryEnvelope(body.recovery_envelope);
    if (recErr) {
      return errorResponse(
        "CRYPTO_VERSION_UNSUPPORTED",
        `Invalid recovery envelope: ${recErr}`,
        400,
        false,
      );
    }
  }

  const auth = await authenticate(context.request, context.env, {
    requireSignature: true,
    path: url.pathname,
    method: "PUT",
    bodyText: rawBody,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const vaultId = auth.device.vaultId;

  // Rate limit: 10 per vault per hour
  const rl = await checkRateLimit(
    context.env,
    "crypto-metadata-update",
    vaultId,
    10,
    3600,
  );
  if (rl.limited) {
    return rateLimitedResponse(rl.retryAfter!);
  }

  try {
    const vault: any = await context.env.DB.prepare(
      `SELECT crypto_format_version, master_key_version FROM vaults WHERE vault_id = ?`,
    )
      .bind(vaultId)
      .first();

    if (!vault) {
      return errorResponse(
        "VAULT_NOT_FOUND",
        "The specified vault does not exist.",
        404,
        false,
      );
    }

    if (
      vault.crypto_format_version !== body.expected_crypto_format_version ||
      vault.master_key_version !== body.expected_key_version
    ) {
      return errorResponse(
        "VERSION_MISMATCH",
        "Key version or format version mismatch. Update the app.",
        409,
        false,
      );
    }

    const me = body.master_envelope;
    const nowIso = new Date().toISOString();

    let sql = `UPDATE vaults SET
      crypto_format_version = ?,
      kdf_version = ?,
      kdf_m_kib = ?,
      kdf_t = ?,
      kdf_p = ?,
      salt = ?,
      master_nonce = ?,
      master_wrapped_dek = ?,
      master_key_version = ?,
      updated_at = ?`;

    const binds: any[] = [
      me.crypto_format_version,
      me.kdf_version,
      me.argon2_m_kib,
      me.argon2_t,
      me.argon2_p,
      me.salt_b64u,
      me.nonce_b64u,
      me.wrapped_dek_b64u,
      me.key_version,
      nowIso,
    ];

    if (body.recovery_envelope) {
      const re = body.recovery_envelope;
      sql += `, recovery_crypto_format_version = ?, recovery_key_version = ?, recovery_nonce = ?, recovery_wrapped_dek = ?`;
      binds.push(
        re.crypto_format_version,
        re.key_version,
        re.nonce_b64u,
        re.wrapped_dek_b64u,
      );
    }

    if (typeof body.recovery_auth_verifier === "string") {
      sql += `, recovery_auth_verifier = ?`;
      binds.push(body.recovery_auth_verifier);
    }

    sql += ` WHERE vault_id = ?`;
    binds.push(vaultId);

    await context.env.DB.prepare(sql).bind(...binds).run();

    return json(
      {
        vault_id: vaultId,
        crypto_format_version: me.crypto_format_version,
        key_version: me.key_version,
        updated_at: nowIso,
      },
      200,
    );
  } catch {
    return errorResponse(
      "INTERNAL_ERROR",
      "Failed to update crypto metadata in database.",
      500,
      true,
    );
  }
};
