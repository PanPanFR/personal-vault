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

export function serverTime(date = new Date()): string {
  return date.toISOString();
}

export function json(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    ...SECURITY_HEADERS,
    "X-Server-Time": serverTime(),
    ...extraHeaders,
  });
  return new Response(JSON.stringify(data), { status, headers });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  retryable: boolean,
  retryAfter?: number,
): Response {
  const extra: Record<string, string> = {};
  if (retryAfter !== undefined) {
    extra["Retry-After"] = String(retryAfter);
  }
  return json({ code, message, retryable }, status, extra);
}

export function bytesLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Read a JSON request body with a hard pre-parse size gate. Enforced on the
 * RAW bytes before JSON.parse so an oversized body can never be materialised
 * as an object (api-spec 1.5 caps, threat-model 7). Works even when
 * Content-Length is absent or lying.
 */
export const MAX_JSON_BODY_BYTES = 1024 * 1024; // 1 MiB

export async function readJsonBody(
  request: Request,
  maxBytes: number = MAX_JSON_BODY_BYTES,
): Promise<{ ok: true; value: any; raw: string } | { ok: false; response: Response }> {
  const raw = await request.text();
  if (bytesLength(raw) > maxBytes) {
    return {
      ok: false,
      response: errorResponse(
        "PAYLOAD_TOO_LARGE",
        `Request body exceeds ${Math.floor(maxBytes / 1024)} KiB limit.`,
        413,
        false,
      ),
    };
  }
  try {
    return { ok: true, value: JSON.parse(raw), raw };
  } catch {
    return {
      ok: false,
      response: errorResponse(
        "VALIDATION_ERROR",
        "Request body is not valid JSON.",
        400,
        false,
      ),
    };
  }
}
