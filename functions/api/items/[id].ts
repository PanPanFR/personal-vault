// PUT    /api/items/:id — upsert one item (body = full item JSON).
// DELETE /api/items/:id — hard delete (idempotent).
import { errorResponse, json, readJsonBody } from "../../_shared/http";
import { getRequestSession, type Env } from "../../_shared/auth";
import type { PagesFunction } from "../../_shared/http";
import { assertPlaintextSize, ItemSchema } from "../../../src/lib/schemas";

/** Raw-body gate; the client additionally caps the item at 256 KiB. */
const MAX_BODY_BYTES = 300 * 1024;

function itemId(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const token = await getRequestSession(request, env);
  if (!token) return errorResponse(401, "unauthorized");

  const id = String(params.id ?? "");
  if (!id) return errorResponse(400, "missing_id");

  const body = await readJsonBody(request, MAX_BODY_BYTES);
  if (!body.ok) return body.response;
  if (itemId(body.value) === null) return errorResponse(400, "invalid_item");

  // Same schema the client enforces: a compromised or stale client cannot
  // write a shape the UI would later fail to read.
  const parsed = ItemSchema.safeParse(body.value);
  if (!parsed.success) return errorResponse(400, "invalid_item");
  // `id` is not part of the item schema; `itemId` above proved it exists and
  // passthrough keeps it on the parsed value.
  const item = parsed.data as typeof parsed.data & { id: string };
  try {
    assertPlaintextSize(item);
  } catch {
    return errorResponse(413, "payload_too_large");
  }
  // The row key and the payload id must agree: the UI keys on the item id, so
  // a mismatch would fork the record into a second row on the next save.
  if (item.id !== id) return errorResponse(400, "id_mismatch");

  await env.DB.prepare(
    `INSERT INTO items (id, payload, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
  )
    .bind(id, JSON.stringify(item), item.updated_at)
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
