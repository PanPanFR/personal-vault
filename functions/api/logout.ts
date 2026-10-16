// POST /api/logout — destroy the session row and clear the cookie.
import { json } from "../_shared/http";
import {
  clearedCookie,
  destroySession,
  getRequestSession,
  isSecureRequest,
  type Env,
} from "../_shared/auth";
import type { PagesFunction } from "../_shared/http";

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = await getRequestSession(request, env);
  if (token) await destroySession(env, token);
  return json({ ok: true }, 200, {
    "Set-Cookie": clearedCookie(isSecureRequest(request)),
  });
};
