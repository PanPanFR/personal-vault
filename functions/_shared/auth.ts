// Single-password session gate.
//
// The whole model: PV_PASSWORD is a Worker secret; a correct password mints an
// opaque random token stored in D1 (`sessions`) and handed back as an HttpOnly
// cookie. Every data route checks the cookie against the table. That's it —
// no hashing ceremony, no device keys, no signatures.
import { parseCookies } from "./http";
import type { D1Database } from "./d1";

export interface Env {
  DB: D1Database;
  PV_PASSWORD?: string;
}

export const SESSION_COOKIE = "pv_session";
export const SESSION_DAYS = 90;
const SESSION_TTL_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compare two secrets without leaking where the first difference is. */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export async function getRequestSession(request: Request, env: Env): Promise<string | null> {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const row = await env.DB.prepare(
    "SELECT token_hash FROM sessions WHERE token_hash = ? AND expires_at > ?",
  )
    .bind(await sha256Hex(token), new Date().toISOString())
    .first();
  return row ? token : null;
}

/** Drop expired rows; keep the table from growing forever. */
export async function purgeExpiredSessions(env: Env): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .bind(new Date().toISOString())
    .run();
}

export async function createSession(env: Env): Promise<string> {
  const token = newToken();
  const now = Date.now();
  await purgeExpiredSessions(env);
  await env.DB.prepare("INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)")
    .bind(
      await sha256Hex(token),
      new Date(now).toISOString(),
      new Date(now + SESSION_TTL_MS).toISOString(),
    )
    .run();
  return token;
}

export async function destroySession(env: Env, token: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
    .bind(await sha256Hex(token))
    .run();
}

export function sessionCookie(token: string, secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${SESSION_TTL_MS / 1000}`,
  ];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearedCookie(secure: boolean): string {
  const attrs = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}
