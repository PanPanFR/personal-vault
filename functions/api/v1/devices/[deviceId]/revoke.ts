import { json, errorResponse, type PagesFunction, bytesLength, MAX_JSON_BODY_BYTES } from "../../../../_shared/http";
import { authenticate } from "../../../../_shared/auth";
import { isUuidV4 } from "../../../../_shared/crypto";

export const onRequestPost: PagesFunction<any> = async (context) => {
  const targetDeviceId = context.params.deviceId as string;
  if (!isUuidV4(targetDeviceId)) {
    return errorResponse(
      "VALIDATION_ERROR",
      "deviceId in path must be a valid UUIDv4.",
      400,
      false,
    );
  }

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

  const auth = await authenticate(context.request, context.env, {
    requireSignature: true,
    path: url.pathname,
    method: "POST",
    bodyText: rawBody,
  });

  if (!auth.ok) {
    return auth.response;
  }

  const vaultId = auth.device.vaultId;

  try {
    const target: any = await context.env.DB.prepare(
      `SELECT device_id, revoked_at FROM authorized_devices WHERE vault_id = ? AND device_id = ?`,
    )
      .bind(vaultId, targetDeviceId)
      .first();

    if (!target) {
      return errorResponse(
        "VAULT_NOT_FOUND",
        "Target device does not exist in this vault.",
        404,
        false,
      );
    }

    const nowIso = new Date().toISOString();
    const effectiveRevokedAt = target.revoked_at ?? nowIso;

    // Idempotent revocation update
    if (target.revoked_at === null) {
      await context.env.DB.prepare(
        `UPDATE authorized_devices
         SET revoked_at = ?
         WHERE vault_id = ? AND device_id = ?`,
      )
        .bind(nowIso, vaultId, targetDeviceId)
        .run();
    }

    return json(
      {
        device_id: targetDeviceId,
        revoked_at: effectiveRevokedAt,
        status: "revoked",
      },
      200,
    );
  } catch {
    return errorResponse("INTERNAL_ERROR", "Failed to revoke device.", 500, true);
  }
};
