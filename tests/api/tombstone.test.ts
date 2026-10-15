// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { seedVault, seedSecondDevice } from "../helpers/seed";
import { SyncApiClient } from "../../src/sync/client";
import { applyRemoteChanges } from "../../src/sync/download-apply";
import { createDb, type PersonalVaultDB } from "../../src/db/dexie-schema";
import { newRecordId, newMutationId } from "../../src/lib/ids";

/**
 * Gap 7 — TOMBSTONE NEVER RESURRECTS.
 * (a) After a remote delete, a stale offline client holding the pre-delete
 *     revision gets 409 (not a silent resurrection); the server tombstone
 *     survives.
 * (b) Once a local record is tombstoned, applying an older non-tombstone
 *     change must NOT un-delete it.
 */
describe("Tombstone Never Resurrects", { timeout: 60000 }, () => {
  let server: TestServer;
  let client: SyncApiClient;
  let sodium: any;
  let vaultId: string;
  let credsA: any;
  let credsB: any;

  beforeEach(async () => {
    server = new TestServer();
    client = new SyncApiClient("", server.fetch.bind(server) as any);
    const seed = await seedVault(server);
    vaultId = seed.vaultId;
    sodium = seed.sodium;
    credsA = seed.creds;
    const devB = await seedSecondDevice(server, sodium, vaultId, "Device-B");
    credsB = devB.creds;
  });

  afterEach(() => {
    server.close();
  });

  function put(recordId: string, expectedRevision: number, extra: Record<string, unknown> = {}) {
    return {
      mutation_id: newMutationId(),
      record_id: recordId,
      expected_revision: expectedRevision,
      schema_version: 1,
      key_version: 1,
      is_tombstone: false,
      ciphertext: "live_ct",
      nonce_b64u: "live_nonce",
      ...extra,
    };
  }

  it("stale offline edit vs remote delete -> 409 with tombstone state, no resurrection", async () => {
    const recordId = newRecordId();

    // Device A creates rev 1; device B conceptually holds rev 1 (goes offline).
    await client.postSyncBatch([put(recordId, 0)], credsA);

    // Device A deletes -> rev 2 tombstone.
    const del = await client.postSyncBatch(
      [
        {
          mutation_id: newMutationId(),
          record_id: recordId,
          expected_revision: 1,
          schema_version: 1,
          key_version: 1,
          is_tombstone: true,
          ciphertext: null,
          nonce_b64u: null,
        },
      ],
      credsA,
    );
    expect(del.results[0].revision).toBe(2);

    // Stale device B edits based on pre-delete rev 1 -> must be 409, never a
    // silent resurrection of the record.
    let conflict: any;
    try {
      await client.postSyncBatch([put(recordId, 1, { ciphertext: "stale_edit_ct" })], credsB);
    } catch (e) {
      conflict = e;
    }
    expect(conflict).toBeTruthy();
    expect(conflict.code).toBe("REVISION_CONFLICT");
    expect(conflict.httpStatus).toBe(409);
    expect(conflict.retryable).toBe(false);
    expect(conflict.data.record_id).toBe(recordId);
    expect(conflict.data.server_revision).toBe(2);
    expect(conflict.data.is_tombstone).toBe(true);

    // Server still holds the tombstone: pull shows delete marker, null payload.
    const page = await client.getSync(1, 50, credsA);
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0].is_tombstone).toBe(true);
    expect(page.changes[0].ciphertext).toBeNull();
    expect(page.changes[0].nonce_b64u).toBeNull();
    expect(page.changes[0].revision).toBe(2);
  });

  it("delete-vs-delete converges without conflict (idempotent, stays deleted)", async () => {
    const recordId = newRecordId();
    await client.postSyncBatch([put(recordId, 0)], credsA);
    await client.postSyncBatch(
      [
        {
          mutation_id: newMutationId(),
          record_id: recordId,
          expected_revision: 1,
          schema_version: 1,
          key_version: 1,
          is_tombstone: true,
          ciphertext: null,
          nonce_b64u: null,
        },
      ],
      credsA,
    );

    // Device B deletes at the CURRENT revision -> clean commit, still a tombstone.
    const res = await client.postSyncBatch(
      [
        {
          mutation_id: newMutationId(),
          record_id: recordId,
          expected_revision: 2,
          schema_version: 1,
          key_version: 1,
          is_tombstone: true,
          ciphertext: null,
          nonce_b64u: null,
        },
      ],
      credsB,
    );
    expect(res.results[0].revision).toBe(3);

    const page = await client.getSync(2, 50, credsA);
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0].is_tombstone).toBe(true);
    expect(page.changes[0].ciphertext).toBeNull();
  });

  // Regression guard for the silent-resurrection bug: applyRemoteChanges()
  // upserts only forward in revision, and a tombstone is never resurrected by
  // an older non-tombstone revision ("deleted never returns", sync-protocol 3.2).
  it("locally tombstoned record ignores an older non-tombstone change (no un-delete)", async () => {
    const db: PersonalVaultDB = createDb(`tomb-${crypto.randomUUID()}`);
    try {
      await db.app_metadata.put({ key: "sync", last_sync_cursor: 0, last_sync_time: null });
      const recordId = newRecordId();
      const now = new Date().toISOString();

      // Local state: record tombstoned at revision 2 (downloaded delete).
      await applyRemoteChanges(
        db,
        [
          {
            change_seq: 2,
            record_id: recordId,
            revision: 2,
            schema_version: 1,
            key_version: 1,
            is_tombstone: true,
            ciphertext: null,
            nonce_b64u: null,
            updated_at: now,
          },
        ],
        2,
      );
      expect((await db.records.get(recordId))?.is_deleted).toBe(true);

      // A stale page carrying the OLDER non-tombstone revision 1 arrives
      // (reordered replay). It must NOT resurrect the record.
      await applyRemoteChanges(
        db,
        [
          {
            change_seq: 1,
            record_id: recordId,
            revision: 1,
            schema_version: 1,
            key_version: 1,
            is_tombstone: false,
            ciphertext: "stale_live_ct",
            nonce_b64u: "stale_live_nonce",
            updated_at: now,
          },
        ],
        2,
      );

      const row = await db.records.get(recordId);
      expect(row?.is_deleted).toBe(true);
      expect(row?.ciphertext).toBeNull();
      expect(row?.server_revision).toBe(2);
    } finally {
      await db.delete();
    }
  });
});
