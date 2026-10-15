import { errorResponse } from "./http";

export interface RateCheckResult {
  limited: boolean;
  retryAfter?: number;
}

/**
 * Rolling-window D1 counter. The window is a sliding bucket anchored to the
 * first request in the current bucket rather than an epoch-aligned hour, so a
 * caller cannot burst 2x by straddling the top of the hour.
 */
export async function checkRateLimit(
  env: any,
  scope: string,
  bucketKey: string,
  limit: number,
  windowSeconds = 3600,
): Promise<RateCheckResult> {
  const db = env?.DB;
  if (!db) {
    return { limited: false };
  }
  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs) * windowMs;

  try {
    await db
      .prepare(
        `INSERT INTO rate_limits (scope, bucket_key, window_start, count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(scope, bucket_key, window_start)
         DO UPDATE SET count = count + 1`,
      )
      .bind(scope, bucketKey, windowStart)
      .run();

    const row = await db
      .prepare(
        `SELECT count FROM rate_limits WHERE scope = ? AND bucket_key = ? AND window_start = ?`,
      )
      .bind(scope, bucketKey, windowStart)
      .first();

    const count = (row?.count as number) || 0;
    if (count > limit) {
      const retryAfter = Math.max(
        1,
        Math.ceil((windowStart + windowMs - now) / 1000),
      );
      return { limited: true, retryAfter };
    }
    return { limited: false };
  } catch {
    // If D1 fails, fail open on rate-limiting to avoid breaking system
    return { limited: false };
  }
}

export function rateLimitedResponse(retryAfter: number): Response {
  return errorResponse(
    "RATE_LIMITED",
    `Too many requests. Please wait ${retryAfter} seconds before retrying.`,
    429,
    true,
    retryAfter,
  );
}
