import { json, errorResponse, type PagesFunction, bytesLength, MAX_JSON_BODY_BYTES } from "../../_shared/http";
import { authenticate } from "../../_shared/auth";
import { checkRateLimit, rateLimitedResponse } from "../../_shared/rate-limit";
import { isSha256Hex } from "../../_shared/crypto";

export const onRequestPost: PagesFunction<any> = async (context) => {
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

  if (!body || typeof body !== "object" || !isSha256Hex(body.ticket_hash)) {
    return errorResponse(
      "VALIDATION_ERROR",
      "ticket_hash must be a 64-character SHA-256 hex string.",
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

  const deviceId = auth.device.deviceId;
  const vaultId = auth.device.vaultId;

  // Rate limit: 5 requests per device per hour
  const rl = await checkRateLimit(
    context.env,
    "pairing-ticket-create",
    deviceId,
    5,
    3600,
  );
  if (rl.limited) {
    return rateLimitedResponse(rl.retryAfter!);
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + 300 * 1000).toISOString(); // 5 minutes TTL
  const ticketId = crypto.randomUUID();

  try {
    // Single-active-ticket invariant: invalidate previous active tickets
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE pairing_tickets
         SET consumed_at = ?
         WHERE vault_id = ? AND consumed_at IS NULL`,
      ).bind(nowIso, vaultId),
      context.env.DB.prepare(
        `INSERT INTO pairing_tickets (
          ticket_hash, vault_id, expires_at, consumed_at, created_at, ticket_id
        ) VALUES (?, ?, ?, NULL, ?, ?)`,
      ).bind(body.ticket_hash, vaultId, expiresAt, nowIso, ticketId),
    ]);

    return json(
      {
        ticket_id: ticketId,
        expires_at: expiresAt,
      },
      201,
    );
  } catch {
    return errorResponse("INTERNAL_ERROR", "Failed to create pairing ticket.", 500, true);
  }
};
