// GET /api/items — the whole vault, newest first.
//
// Personal scale: a single user with well under a thousand items; one SELECT
// is the entire "sync protocol".
import { errorResponse, json } from "../../_shared/http";
import { getRequestSession, type Env } from "../../_shared/auth";
import type { PagesFunction } from "../../_shared/http";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = await getRequestSession(request, env);
  if (!token) return errorResponse(401, "unauthorized");

  const { results } = (await env.DB.prepare(
    "SELECT payload FROM items ORDER BY updated_at DESC",
  ).all()) as { results: { payload: string }[] };

  const items = results.flatMap((row) => {
    try {
      return [JSON.parse(row.payload)];
    } catch {
      return []; // a corrupt row must not take the whole vault down
    }
  });

  return json({ items });
};
