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

export function errorResponse(
  status: number,
  code: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return json({ error: code }, status, extraHeaders);
}

export function bytesLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export type ReadBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; response: Response };

export type ReadTextResult =
  | { ok: true; text: string }
  | { ok: false; response: Response };

/**
 * Read a body without ever buffering more than `maxBytes`.
 *
 * `request.text()` allocates the whole body first, so a caller-supplied limit
 * checked afterwards protects nothing. Content-Length is checked up front and
 * the stream is cancelled as soon as it crosses the cap.
 */
export async function readCappedText(request: Request, maxBytes: number): Promise<ReadTextResult> {
  const declared = request.headers.get("content-length");
  if (declared && Number.isFinite(Number(declared)) && Number(declared) > maxBytes) {
    return { ok: false, response: errorResponse(413, "payload_too_large") };
  }

  const reader = request.body?.getReader();
  if (!reader) return { ok: true, text: "" };

  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, response: errorResponse(413, "payload_too_large") };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, response: errorResponse(400, "invalid_body") };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

/** Size-gated JSON body reader: cap enforced on raw bytes before JSON.parse. */
export async function readJsonBody(request: Request, maxBytes: number): Promise<ReadBodyResult> {
  const body = await readCappedText(request, maxBytes);
  if (!body.ok) return body;
  try {
    return { ok: true, value: JSON.parse(body.text) };
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
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      // A malformed escape must not turn every request into a 500.
      out[name] = value;
    }
  }
  return out;
}
