// GET /api/session — does the request carry a valid session?
import { json } from "../_shared/http";
import { getRequestSession, type Env } from "../_shared/auth";
import type { PagesFunction } from "../_shared/http";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = await getRequestSession(request, env);
  return json({ authenticated: token !== null });
};
