// POST /api/login — { password } → session cookie on success.
//
// Brute-force guard: per-IP in-memory attempt counter (per isolate). Good
// enough for a personal vault: 10 attempts / 10 minutes.
import { errorResponse, json, readCappedText } from "../_shared/http";
import {
  constantTimeEqual,
  createSession,
  isSecureRequest,
  sessionCookie,
  type Env,
} from "../_shared/auth";
import type { PagesFunction } from "../_shared/http";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const LOGIN_MAX_BODY_BYTES = 1024;
const MAX_TRACKED_IPS = 1000;

const attempts = new Map<string, { count: number; resetAt: number }>();

/** Drop expired entries so a long-lived isolate cannot grow without bound. */
function pruneExpired(now: number): void {
  for (const [ip, entry] of attempts) {
    if (now >= entry.resetAt) attempts.delete(ip);
  }
}

function isRateLimited(ip: string, now = Date.now()): boolean {
  const entry = attempts.get(ip);
  if (!entry || now >= entry.resetAt) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function retryAfterSeconds(ip: string, now = Date.now()): number {
  const entry = attempts.get(ip);
  if (!entry) return WINDOW_MS / 1000;
  return Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
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
  const now = Date.now();
  if (attempts.size > MAX_TRACKED_IPS) pruneExpired(now);

  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  if (isRateLimited(ip, now)) {
    return errorResponse(429, "too_many_attempts", {
      "Retry-After": String(retryAfterSeconds(ip, now)),
    });
  }

  const body = await readCappedText(request, LOGIN_MAX_BODY_BYTES);
  if (!body.ok) return body.response;

  let password = "";
  try {
    const parsed = JSON.parse(body.text) as { password?: unknown };
    if (typeof parsed?.password === "string") password = parsed.password;
  } catch {
    // fall through to the 401 below
  }

  if (!env.PV_PASSWORD) return errorResponse(500, "password_not_configured");
  if (!password || !(await constantTimeEqual(password, env.PV_PASSWORD))) {
    recordFailure(ip, now);
    return errorResponse(401, "wrong_password");
  }

  attempts.delete(ip);
  const token = await createSession(env);
  return json({ ok: true }, 200, {
    "Set-Cookie": sessionCookie(token, isSecureRequest(request)),
  });
};
