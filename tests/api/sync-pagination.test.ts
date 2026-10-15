// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { seedVault } from "../helpers/seed";
import { SyncApiClient } from "../../src/sync/client";
import { newRecordId, newMutationId } from "../../src/lib/ids";

/**
 * Gap 1 — PAGINATION UNDER CONCURRENT WRITES.
 * GET /api/v1/sync must never skip a change_seq, even when new writes land
 * between page fetches. change_seq is append-only + monotonic, so a client
 * paging with cursor=last_seen_seq must observe every seq exactly once.
 */
describe("Sync Pagination Under Concurrent Writes", { timeout: 90000 }, () => {
  let server: TestServer;
  let client: SyncApiClient;
  let vaultId: string;
  let creds: any;

  beforeEach(async () => {
    server = new TestServer();
    client = new SyncApiClient("", server.fetch.bind(server) as any);
    const seed = await seedVault(server);
    vaultId = seed.vaultId;
    creds = seed.creds;
  });

  afterEach(() => {
    server.close();
  });

  /** Pushes `count` fresh records in batches of <= 50. Returns in commit order. */
  async function pushRecords(count: number, prefix: string) {
    const mutations = Array.from({ length: count }, (_, i) => ({
      mutation_id: newMutationId(),
      record_id: newRecordId(),
      expected_revision: 0,
      schema_version: 1,
      key_version: 1,
      is_tombstone: false,
      ciphertext: `${prefix}_ct_${i}`,
      nonce_b64u: `${prefix}_nonce_${i}`,
    }));
    const committed: any[] = [];
    for (let i = 0; i < mutations.length; i += 50) {
      const chunk = mutations.slice(i, i + 50);
      const res = await client.postSyncBatch(chunk, creds);
      committed.push(...res.results);
    }
    return committed;
  }

  /** Drains all pages from `cursor` with the given limit. Returns all changes in fetch order. */
  async function drainPages(cursor: number, limit: number) {
    const seen: any[] = [];
    let pageCount = 0;
    let c = cursor;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await client.getSync(c, limit, creds);
      pageCount += 1;
      expect(page.next_cursor).toBeGreaterThanOrEqual(c);
      if (page.changes.length === 0) {
        expect(page.has_more).toBe(false);
        expect(page.next_cursor).toBe(c);
        break;
      }
      seen.push(...page.changes);
      c = page.next_cursor;
      if (!page.has_more) break;
      if (pageCount > 500) throw new Error("pagination did not terminate");
    }
    return { seen, pageCount };
  }

  it("pages 65 changes with limit=1: every change_seq seen exactly once, ascending", async () => {
    await pushRecords(65, "pag1");

    const { seen } = await drainPages(0, 1);

    expect(seen).toHaveLength(65);
    const seqs = seen.map((c) => c.change_seq);
    expect(seqs).toEqual(Array.from({ length: 65 }, (_, i) => i + 1));
    // No gaps, no duplicates, strictly ascending
    expect(new Set(seqs).size).toBe(65);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1] + 1);
    }
  });

  it("pages 65 changes with limit=50: two pages, has_more toggles, no skip", async () => {
    await pushRecords(65, "pag50");

    const p1 = await client.getSync(0, 50, creds);
    expect(p1.changes).toHaveLength(50);
    expect(p1.has_more).toBe(true);
    expect(p1.next_cursor).toBe(50);

    const p2 = await client.getSync(p1.next_cursor, 50, creds);
    expect(p2.changes).toHaveLength(15);
    expect(p2.has_more).toBe(false);
    expect(p2.next_cursor).toBe(65);

    const seqs = [...p1.changes, ...p2.changes].map((c) => c.change_seq);
    expect(seqs).toEqual(Array.from({ length: 65 }, (_, i) => i + 1));
  });

  it("never skips when new writes land between pages", async () => {
    await pushRecords(60, "concur");

    // Page 1: seqs 1..10
    const p1 = await client.getSync(0, 10, creds);
    expect(p1.changes).toHaveLength(10);
    expect(p1.has_more).toBe(true);

    // Concurrent writer lands 5 NEW changes (seqs 61..65) before page 2
    await pushRecords(5, "late");

    // Drain the rest from cursor=10
    const rest: any[] = [];
    let c = p1.next_cursor;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const page = await client.getSync(c, 10, creds);
      if (page.changes.length === 0) {
        expect(page.has_more).toBe(false);
        break;
      }
      rest.push(...page.changes);
      c = page.next_cursor;
      if (!page.has_more) break;
    }

    const all = [...p1.changes, ...rest];
    expect(all).toHaveLength(65);
    const seqs = all.map((x) => x.change_seq);
    expect(seqs).toEqual(Array.from({ length: 65 }, (_, i) => i + 1));
    expect(new Set(seqs).size).toBe(65);
  });

  it("interleaves a write between EVERY page (limit=7) without skip or dupe", async () => {
    await pushRecords(20, "inter");

    // Page 1 -> seqs 1..7, then a concurrent write lands (seq 21)
    const p1 = await client.getSync(0, 7, creds);
    expect(p1.changes.map((c) => c.change_seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(p1.has_more).toBe(true);
    await pushRecords(1, "mid1");

    // Page 2 -> seqs 8..14, then another write lands (seq 22)
    const p2 = await client.getSync(p1.next_cursor, 7, creds);
    expect(p2.changes.map((c) => c.change_seq)).toEqual([8, 9, 10, 11, 12, 13, 14]);
    expect(p2.has_more).toBe(true);
    await pushRecords(1, "mid2");

    // Page 3 -> seqs 15..21, then another write lands (seq 23)
    const p3 = await client.getSync(p2.next_cursor, 7, creds);
    expect(p3.changes.map((c) => c.change_seq)).toEqual([15, 16, 17, 18, 19, 20, 21]);
    expect(p3.has_more).toBe(true);
    await pushRecords(1, "mid3");

    // Drain the tail: seqs 22..23 (short page, has_more=false), then empty page
    const tail = await client.getSync(p3.next_cursor, 7, creds);
    expect(tail.changes.map((c) => c.change_seq)).toEqual([22, 23]);
    expect(tail.has_more).toBe(false);

    const probe = await client.getSync(tail.next_cursor, 7, creds);
    expect(probe.changes).toHaveLength(0);
    expect(probe.has_more).toBe(false);

    const seqs = [...p1.changes, ...p2.changes, ...p3.changes, ...tail.changes].map(
      (x) => x.change_seq,
    );
    expect(seqs).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
  });

  it("limit exactly equals remaining changes: has_more is true, then next page is empty", async () => {
    await pushRecords(10, "exact");

    // 10 remaining, limit=10 -> full page AND has_more=true (length === limit)
    const p1 = await client.getSync(0, 10, creds);
    expect(p1.changes).toHaveLength(10);
    expect(p1.next_cursor).toBe(10);
    expect(p1.has_more).toBe(true);

    // Following page must be empty with has_more=false and a stable cursor
    const p2 = await client.getSync(p1.next_cursor, 10, creds);
    expect(p2.changes).toHaveLength(0);
    expect(p2.has_more).toBe(false);
    expect(p2.next_cursor).toBe(10);
  });
});
