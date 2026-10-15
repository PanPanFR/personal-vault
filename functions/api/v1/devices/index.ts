import { json, errorResponse, type PagesFunction } from "../../../_shared/http";
import { authenticate } from "../../../_shared/auth";

/**
 * GET /api/v1/devices — paired-device list for the Settings surface.
 *
 * `last_used_at` is written server-side by _shared/auth.ts on every
 * authenticated request (PRD §FR-5 G13): no client timestamp is accepted, and
 * nothing token-shaped or secret is echoed back.
 */
export const onRequestGet: PagesFunction<any> = async (context) => {
  const url = new URL(context.request.url);
  const auth = await authenticate(context.request, context.env, {
    requireSignature: false,
    path: url.pathname,
    method: "GET",
  });

  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await context.env.DB.prepare(
      `SELECT device_id, label, created_at, last_used_at, revoked_at, last_ack_cursor
         FROM authorized_devices
        WHERE vault_id = ?
        ORDER BY created_at ASC`,
    )
      .bind(auth.device.vaultId)
      .all();

    const devices = (result.results ?? []).map((row: any) => ({
      device_id: row.device_id,
      label: row.label,
      created_at: row.created_at,
      // Server-recorded only — the client cannot spoof its own last-seen.
      last_seen_at: row.last_used_at,
      last_ack_cursor: row.last_ack_cursor ?? null,
      revoked_at: row.revoked_at ?? null,
    }));

    return json({ vault_id: auth.device.vaultId, devices }, 200);
  } catch {
    return errorResponse("INTERNAL_ERROR", "Database error.", 500, true);
  }
};