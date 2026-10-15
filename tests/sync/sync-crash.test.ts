// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { seedVault } from "../helpers/seed";
import { SyncApiClient } from "../../src/sync/client";
import { SyncEngine } from "../../src/sync/engine";
import { applyRemoteChanges } from "../../src/sync/download-apply";
import { createDb, type PersonalVaultDB } from "../../src/db/dexie-schema";
import { newRecordId, newMutationId } from "../../src/lib/ids";

/**
 * Gap 3 — CRASH BETWEEN WRITE AND CURSOR COMMIT (fault injection).
 *
 * Production invariant under test: applyRemoteChanges() persists downloaded
 * records AND advances app_metadata 'sync'.last_sync_cursor inside ONE Dexie
 * transaction, and re-apply is keyed idempotently — so a crash that lands
 * after the record writes but before the cursor commit replays safely.
 */
describe("Sync Crash Safety (fault injection)", { timeout: 60000 }, () => {
  let server: TestServer;
  let client: SyncApiClient;
  let db: PersonalVaultDB;
  let creds: any;

  beforeEach(async () => {
    server = new TestServer();
    client = new SyncApiClient("", server.fetch.bind(server) as any);
    const seed = await seedVault(server);
    creds = seed.creds;
    db = createDb(`crash-db-${crypto.randomUUID()}`);
    await db.app_metadata.put({ key: "sync", last_sync_cursor: 0, last_sync_time: null });
  });

  afterEach(async () => {
    server.close();
    await db.delete();
  });

  async function pushServerRecords(count: number, prefix: string) {
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
    const all: any[] = [];
    for (let i = 0; i < mutations.length; i += 50) {
      const res = await client.postSyncBatch(mutations.slice(i, i + 50), creds);
      all.push(...res.results);
    }
    return { mutations, results: all };
  }

  it("crash after record writes, before cursor commit: re-sync converges with no dupes", async () => {
    const { mutations } = await pushServerRecords(3, "crash");

    // Client downloads the page...
    const page = await client.getSync(0, 50, creds);
    expect(page.changes).toHaveLength(3);

    // ...writes the records to Dexie, then CRASHES before committing the cursor.
    // Fault injection: replicate exactly the record-put half of
    // applyRemoteChanges, without touching app_metadata.
    for (const c of page.changes) {
      await db.records.put({
        record_id: c.record_id,
        ciphertext: c.ciphertext,
        nonce: c.nonce_b64u,
        schema_version: c.schema_version,
        key_version: c.key_version,
        local_revision: c.revision,
        server_revision: c.revision,
        sync_state: "synced",
        is_deleted: c.is_tombstone,
        updated_at: c.updated_at,
      });
    }
    const metaCrashed = await db.app_metadata.get("sync");
    expect(metaCrashed?.last_sync_cursor).toBe(0); // cursor NOT advanced

    // Next sync cycle re-requests the SAME page from the durable cursor...
    const engine = new SyncEngine(db, client);
    await engine.sync(creds);

    // ...and converges: no duplicate records, no corruption, cursor at head.
    expect(await db.records.count()).toBe(3);
    for (const m of mutations) {
      const row = await db.records.get(m.record_id);
      expect(row).toBeTruthy();
      expect(row?.ciphertext).toBe(m.ciphertext);
      expect(row?.server_revision).toBe(1);
      expect(row?.sync_state).toBe("synced");
    }
    const meta = await db.app_metadata.get("sync");
    expect(meta?.last_sync_cursor).toBe(3);

    // A further cycle is a stable no-op.
    await engine.sync(creds);
    expect(await db.records.count()).toBe(3);
    expect((await db.app_metadata.get("sync"))?.last_sync_cursor).toBe(3);
    const status = await engine.getStatus();
    expect(status.state).toBe("idle");
  });

  it("re-applying the SAME page twice is a safe no-op (deterministic upsert)", async () => {
    await pushServerRecords(2, "reapply");
    const page = await client.getSync(0, 50, creds);

    const r1 = await applyRemoteChanges(db, page.changes, page.next_cursor);
    expect(r1.appliedCount).toBe(2);
    // Crash-replay: the exact same page arrives again (cursor was lost).
    await db.app_metadata.put({ key: "sync", last_sync_cursor: 0, last_sync_time: null });
    const r2 = await applyRemoteChanges(db, page.changes, page.next_cursor);

    expect(r2.appliedCount).toBe(2);
    expect(await db.records.count()).toBe(2); // no duplicates
    for (const c of page.changes) {
      const row = await db.records.get(c.record_id);
      expect(row?.ciphertext).toBe(c.ciphertext);
      expect(row?.server_revision).toBe(c.revision);
      expect(row?.sync_state).toBe("synced");
    }
    expect((await db.app_metadata.get("sync"))?.last_sync_cursor).toBe(page.next_cursor);
  });

  it("engine pull loop replays a crashed page end-to-end (server page -> crash -> sync)", async () => {
    await pushServerRecords(4, "e2e");
    const page = await client.getSync(0, 50, creds);

    // Partial crash: only the FIRST TWO records made it to Dexie, cursor at 0.
    for (const c of page.changes.slice(0, 2)) {
      await db.records.put({
        record_id: c.record_id,
        ciphertext: c.ciphertext,
        nonce: c.nonce_b64u,
        schema_version: c.schema_version,
        key_version: c.key_version,
        local_revision: c.revision,
        server_revision: c.revision,
        sync_state: "synced",
        is_deleted: c.is_tombstone,
        updated_at: c.updated_at,
      });
    }

    const engine = new SyncEngine(db, client);
    await engine.sync(creds);

    // All four records present exactly once; cursor converged to head.
    expect(await db.records.count()).toBe(4);
    for (const c of page.changes) {
      const row = await db.records.get(c.record_id);
      expect(row?.ciphertext).toBe(c.ciphertext);
    }
    expect((await db.app_metadata.get("sync"))?.last_sync_cursor).toBe(4);
  });

  it("documents why the reverse crash is impossible: records + cursor commit in ONE Dexie transaction", async () => {
    await pushServerRecords(2, "atomic");
    const page = await client.getSync(0, 50, creds);

    // Production path: a single applyRemoteChanges call updates BOTH stores
    // atomically (see download-apply.ts: db.transaction("rw", [records,
    // app_metadata])). Assert they always move together.
    await applyRemoteChanges(db, page.changes, page.next_cursor);
    expect(await db.records.count()).toBe(2);
    expect((await db.app_metadata.get("sync"))?.last_sync_cursor).toBe(2);

    // Hazard demonstration (manual state ONLY — production code can never
    // produce it): cursor advanced to head with records missing. The engine
    // then pulls from head, sees zero changes, and the records stay missing —
    // i.e. advancing the cursor WITHOUT the records loses data. This is
    // exactly what the single-transaction commit in applyRemoteChanges
    // prevents: the cursor row is never written unless the record puts in the
    // same transaction also commit.
    const db2 = createDb(`crash-reverse-${crypto.randomUUID()}`);
    try {
      await db2.app_metadata.put({ key: "sync", last_sync_cursor: 2, last_sync_time: null });
      const engine = new SyncEngine(db2, client);
      await engine.sync(creds);
      // Engine saw nothing new (cursor already at head) — records still absent.
      expect(await db2.records.count()).toBe(0);
      expect((await db2.app_metadata.get("sync"))?.last_sync_cursor).toBe(2);
    } finally {
      await db2.delete();
    }
  });
});
