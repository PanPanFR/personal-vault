// PUT    /api/items/:id — upsert one item (body = full item JSON).
// DELETE /api/items/:id — hard delete (idempotent).
import { bytesLength, errorResponse, json, readJsonBody } from "../../_shared/http";
import { getRequestSession, type Env } from "../../_shared/auth";
import type { PagesFunction } from "../../_shared/http";

/** Raw-body gate; the client additionally caps the item at 256 KiB. */
const MAX_BODY_BYTES = 300 * 1024;

function isPlausibleItem(value: unknown): value is { type: string; title: string; updated_at: string } {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.type === "string" &&
    typeof v.title === "string" &&
    typeof v.updated_at === "string" &&
    bytesLength(v.updated_at) < 64
  );
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const token = await getRequestSession(request, env);
  if (!token) return errorResponse(401, "unauthorized");

  const id = String(params.id ?? "");
  if (!id) return errorResponse(400, "missing_id");

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  if (!isPlausibleItem(body.value)) return errorResponse(400, "invalid_item");

  await env.DB.prepare(
    `INSERT INTO items (id, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
  )
    .bind(id, JSON.stringify(body.value), body.value.updated_at)
    .run();

  return json({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const token = await getRequestSession(request, env);
  if (!token) return errorResponse(401, "unauthorized");

  const id = String(params.id ?? "");
  if (!id) return errorResponse(400, "missing_id");

  await env.DB.prepare("DELETE FROM items WHERE id = ?").bind(id).run();
  return json({ ok: true });
};
