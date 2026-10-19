// Shared HTTP helpers for the vault API. Minimal on purpose: JSON responses
// with no-store security headers, a size-gated JSON body reader, and a cookie
// parser. No crypto lives here.

export interface EventContext<Env = any, P extends string = any, Data = any> {
  request: Request;
  functionPath: string;
  waitUntil: (promise: Promise<any>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  env: Env;
  params: Record<P, string | string[]>;
  data: Data;
}

export type PagesFunction<
  Env = any,
  Params extends string = any,
  Data extends Record<string, unknown> = Record<string, unknown>,
> = (context: EventContext<Env, Params, Data>) => Response | Promise<Response>;

export const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  "Pragma": "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
};

export function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...extraHeaders },
  });
}

export function errorResponse(status: number, code: string): Response {
  return json({ error: code }, status);
}

export function bytesLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export type ReadBodyResult =
  | { ok: true; value: any }
  | { ok: false; response: Response };

/** Size-gated JSON body reader: cap enforced on raw bytes before JSON.parse. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<ReadBodyResult> {
  const raw = await request.text();
  if (bytesLength(raw) > maxBytes) {
    return { ok: false, response: errorResponse(413, "payload_too_large") };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, response: errorResponse(400, "invalid_json") };
  }
}

export function parseCookies(request: Request): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = request.headers.get("Cookie");
  if (!raw) return out;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}
