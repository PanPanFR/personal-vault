import { json, errorResponse, type PagesFunction, readJsonBody } from "../../../../_shared/http";
import { authenticate } from "../../../../_shared/auth";
import { isUuidV4 } from "../../../../_shared/crypto";

const LABEL_MAX_LENGTH = 64;

/** POST /api/v1/devices/{deviceId}/label — rename a paired device. */
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
  // Shared body gate: 1 MiB cap enforced on raw bytes before JSON.parse.
  const body = await readJsonBody(context.request);
  if (!body.ok) return body.response;
  const rawBody = body.raw;

  const label: unknown = body.value?.label;
  if (typeof label !== "string" || label.trim().length === 0 || label.length > LABEL_MAX_LENGTH) {
    return errorResponse(
      "VALIDATION_ERROR",
      `label must be a non-empty string of at most ${LABEL_MAX_LENGTH} characters.`,
      400,
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

  try {
    const result = await context.env.DB.prepare(
      `UPDATE authorized_devices SET label = ? WHERE vault_id = ? AND device_id = ?`,
    )
      .bind(label.trim(), auth.device.vaultId, targetDeviceId)
      .run();

    const changes = (result.meta as { changes?: number } | undefined)?.changes ?? 0;
    if (changes === 0) {
      return errorResponse(
        "VAULT_NOT_FOUND",
        "Device does not exist in this vault.",
        404,
        false,
      );
    }

    return json({ device_id: targetDeviceId, label: label.trim(), status: "updated" }, 200);
  } catch {
    return errorResponse("INTERNAL_ERROR", "Database error.", 500, true);
  }
};