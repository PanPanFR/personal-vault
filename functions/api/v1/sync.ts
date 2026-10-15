import { json, errorResponse, type PagesFunction } from "../../_shared/http";
import { authenticate } from "../../_shared/auth";
import { checkRateLimit, rateLimitedResponse } from "../../_shared/rate-limit";

export const onRequestGet: PagesFunction<any> = async (context) => {
  const url = new URL(context.request.url);
  const cursorParam = url.searchParams.get("cursor") ?? "0";
  const limitParam = url.searchParams.get("limit") ?? "50";

  const cursor = Number(cursorParam);
  if (!Number.isInteger(cursor) || cursor < 0) {
    return errorResponse(
      "SYNC_CURSOR_INVALID",
      "cursor must be a non-negative integer.",
      400,
      false,
    );
  }

  const limit = Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return errorResponse(
      "VALIDATION_ERROR",
      "limit must be an integer between 1 and 50.",
      400,
      false,
    );
  }

  const auth = await authenticate(context.request, context.env, {
    requireSignature: false,
    path: url.pathname,
    method: "GET",
  });

  if (!auth.ok) {
    return auth.response;
  }

  const vaultId = auth.device.vaultId;

  // Rate limit: 300 per vault per hour
  const rl = await checkRateLimit(context.env, "sync-pull", vaultId, 300, 3600);
  if (rl.limited) {
    return rateLimitedResponse(rl.retryAfter!);
  }

  try {
    const results: any = await context.env.DB.prepare(
      `SELECT sc.change_seq, sc.record_id, sc.revision,
              vr.schema_version, vr.key_version, vr.is_deleted,
              vr.ciphertext, vr.nonce, vr.updated_at
       FROM sync_changes sc
       LEFT JOIN vault_records vr
         ON vr.vault_id = sc.vault_id AND vr.record_id = sc.record_id
       WHERE sc.vault_id = ? AND sc.change_seq > ?
       ORDER BY sc.change_seq ASC
       LIMIT ?`,
    )
      .bind(vaultId, cursor, limit)
      .all();

    const rows = results?.results ?? [];
    const changes = rows.map((r: any) => {
      const isTombstone = r.is_deleted === 1;
      return {
        change_seq: r.change_seq,
        record_id: r.record_id,
        revision: r.revision,
        schema_version: r.schema_version ?? 1,
        key_version: r.key_version ?? 1,
        is_tombstone: isTombstone,
        ciphertext: isTombstone ? null : (r.ciphertext ?? null),
        nonce_b64u: isTombstone ? null : (r.nonce ?? null),
        updated_at: r.updated_at ?? new Date().toISOString(),
      };
    });

    const nextCursor =
      changes.length > 0 ? changes[changes.length - 1].change_seq : cursor;
    const hasMore = changes.length === limit;

    return json(
      {
        changes,
        next_cursor: nextCursor,
        has_more: hasMore,
      },
      200,
    );
  } catch (err: any) {
    const msg = String(err?.message || "").toLowerCase();
    if (msg.includes("quota")) {
      return errorResponse(
        "QUOTA_EXHAUSTED",
        "Cloudflare free-tier quota exhausted. Cloud sync paused.",
        503,
        true,
      );
    }
    return errorResponse("INTERNAL_ERROR", "Database query failed.", 500, true);
  }
};
