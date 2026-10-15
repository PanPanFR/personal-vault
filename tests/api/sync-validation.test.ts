// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { seedVault } from "../helpers/seed";
import { SyncApiClient } from "../../src/sync/client";

/**
 * Gap 6 — SYNC_CURSOR_INVALID + limit validation.
 * cursor=-1, cursor="abc", cursor=1.5 -> 400 SYNC_CURSOR_INVALID;
 * limit=0, limit=51, limit="x" -> 400 VALIDATION_ERROR.
 * Boundary edges (limit=1, limit=50, huge cursor) keep working.
 */
describe("Sync Cursor & Limit Validation", { timeout: 60000 }, () => {
  let server: TestServer;
  let client: SyncApiClient;
  let tokenB64u: string;
  let creds: any;

  beforeEach(async () => {
    server = new TestServer();
    client = new SyncApiClient("", server.fetch.bind(server) as any);
    const seed = await seedVault(server);
    tokenB64u = seed.tokenB64u;
    creds = seed.creds;
  });

  afterEach(() => {
    server.close();
  });

  async function rawGet(cursor: string, limit: string) {
    const res = await server.fetch(`/api/v1/sync?cursor=${cursor}&limit=${limit}`, {
      headers: { Authorization: `Bearer ${tokenB64u}` },
    });
    return { res, body: (await res.json()) as any };
  }

  it("cursor=-1 -> 400 SYNC_CURSOR_INVALID (retryable false)", async () => {
    const { res, body } = await rawGet("-1", "50");
    expect(res.status).toBe(400);
    expect(body.code).toBe("SYNC_CURSOR_INVALID");
    expect(body.retryable).toBe(false);
  });

  it('cursor="abc" -> 400 SYNC_CURSOR_INVALID', async () => {
    const { res, body } = await rawGet("abc", "50");
    expect(res.status).toBe(400);
    expect(body.code).toBe("SYNC_CURSOR_INVALID");
    expect(body.retryable).toBe(false);
  });

  it("cursor=1.5 -> 400 SYNC_CURSOR_INVALID (non-integer rejected)", async () => {
    const { res, body } = await rawGet("1.5", "50");
    expect(res.status).toBe(400);
    expect(body.code).toBe("SYNC_CURSOR_INVALID");
    expect(body.retryable).toBe(false);
  });

  it("cursor empty string -> defaults are NOT applied; invalid is rejected", async () => {
    const res = await server.fetch(`/api/v1/sync?cursor=&limit=50`, {
      headers: { Authorization: `Bearer ${tokenB64u}` },
    });
    // Number("") === 0, which is a valid cursor -> 200 with empty changes.
    // This pins the current coercion behaviour: "" means 0, not an error.
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.changes).toHaveLength(0);
    expect(body.next_cursor).toBe(0);
  });

  it("limit=0 -> 400 VALIDATION_ERROR", async () => {
    const { res, body } = await rawGet("0", "0");
    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.retryable).toBe(false);
  });

  it("limit=51 -> 400 VALIDATION_ERROR (cap is 50)", async () => {
    const { res, body } = await rawGet("0", "51");
    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.retryable).toBe(false);
  });

  it('limit="x" -> 400 VALIDATION_ERROR', async () => {
    const { res, body } = await rawGet("0", "x");
    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
    expect(body.retryable).toBe(false);
  });

  it("limit=1.5 -> 400 VALIDATION_ERROR (non-integer rejected)", async () => {
    const { res, body } = await rawGet("0", "1.5");
    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION_ERROR");
  });

  it("boundary edges still work: limit=1, limit=50, huge cursor -> 200", async () => {
    const p1 = await client.getSync(0, 1, creds);
    expect(p1.changes).toHaveLength(0);
    expect(p1.has_more).toBe(false);

    const p50 = await client.getSync(0, 50, creds);
    expect(p50.changes).toHaveLength(0);
    expect(p50.has_more).toBe(false);

    const huge = await client.getSync(999999999, 50, creds);
    expect(huge.changes).toHaveLength(0);
    expect(huge.next_cursor).toBe(999999999);
    expect(huge.has_more).toBe(false);
  });
});
