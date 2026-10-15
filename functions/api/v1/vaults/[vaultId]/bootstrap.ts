import { json, errorResponse, type PagesFunction } from "../../../../_shared/http";
import { authenticate } from "../../../../_shared/auth";
import { isVaultId } from "../../../../_shared/crypto";

export const onRequestGet: PagesFunction<any> = async (context) => {
  const vaultId = context.params.vaultId as string;
  if (!isVaultId(vaultId)) {
    return errorResponse(
      "VALIDATION_ERROR",
      "vaultId in path must be a 26-character ULID string.",
      400,
      false,
    );
  }

  const url = new URL(context.request.url);
  const auth = await authenticate(context.request, context.env, {
    requireSignature: false,
    path: url.pathname,
    method: "GET",
    expectedVaultId: vaultId,
  });

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const row: any = await context.env.DB.prepare(
      `SELECT vault_id, crypto_format_version, kdf_version, salt, kdf_m_kib,
              kdf_t, kdf_p, master_nonce, master_wrapped_dek, master_key_version,
              current_change_seq
       FROM vaults
       WHERE vault_id = ?`,
    )
      .bind(vaultId)
      .first();

    if (!row) {
      return errorResponse(
        "VAULT_NOT_FOUND",
        "The specified vault does not exist.",
        404,
        false,
      );
    }

    // Explicitly construct response — NEVER expose recovery_envelope or devices
    const responsePayload = {
      vault_id: row.vault_id,
      crypto_format_version: row.crypto_format_version,
      key_version: row.master_key_version,
      kdf_version: row.kdf_version,
      schema_version: 1,
      master_envelope: {
        crypto_format_version: row.crypto_format_version,
        key_version: row.master_key_version,
        kdf_version: row.kdf_version,
        argon2_m_kib: row.kdf_m_kib,
        argon2_t: row.kdf_t,
        argon2_p: row.kdf_p,
        salt_b64u: row.salt,
        nonce_b64u: row.master_nonce,
        wrapped_dek_b64u: row.master_wrapped_dek,
      },
      change_cursor: row.current_change_seq,
    };

    return json(responsePayload, 200);
  } catch {
    return errorResponse("INTERNAL_ERROR", "Database error.", 500, true);
  }
};
