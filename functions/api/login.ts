// POST /api/login — { password } → session cookie on success.
//
// Brute-force guard: per-IP in-memory attempt counter (per isolate). Good
// enough for a personal vault: 10 attempts / 10 minutes.
import { errorResponse, json } from "../_shared/http";
import { createSession, isSecureRequest, sessionCookie, type Env } from "../_shared/auth";
import type { PagesFunction } from "../_shared/http";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;

const attempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string, now = Date.now()): boolean {
  const entry = attempts.get(ip);
  if (!entry || now >= entry.resetAt) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(ip: string, now = Date.now()): void {
  const entry = attempts.get(ip);
  if (!entry || now >= entry.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
}

/** Test hook — module state would otherwise leak between test cases. */
export function resetRateLimiter(): void {
  attempts.clear();
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  if (isRateLimited(ip)) return errorResponse(429, "too_many_attempts");

  let password = "";
  try {
    const body = (await request.json()) as { password?: unknown };
    if (typeof body?.password === "string") password = body.password;
  } catch {
    // fall through to the 401 below
  }

  if (!env.PV_PASSWORD) return errorResponse(500, "password_not_configured");
  if (!password || password !== env.PV_PASSWORD) {
    recordFailure(ip);
    return errorResponse(401, "wrong_password");
  }

  attempts.delete(ip);
  const token = await createSession(env);
  return json({ ok: true }, 200, {
    "Set-Cookie": sessionCookie(token, isSecureRequest(request)),
  });
};
