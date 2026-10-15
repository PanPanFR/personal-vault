// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { seedVault } from "../helpers/seed";
import { SyncApiClient } from "../../src/sync/client";
import { newRecordId, newMutationId } from "../../src/lib/ids";

/**
 * Gap 2 — RETRY STORM / IDEMPOTENCY BOTH DIRECTIONS.
 * (a) same mutation_id + same payload submitted N times -> identical cached
 *     result, no new revisions, no new sync_changes rows;
 * (b) same mutation_id + altered payload -> REPLAY_DETECTED;
 * (c) PARTIAL batch retry ([A] committed, then [A, B]) -> atomic 409 for the
 *     batch (per api-spec open question Q7: whole-batch reject), A is NOT
 *     double-applied, and B is NOT lost (a retry of B alone still applies).
 */
describe("Sync Batch Retry Storm & Idempotency", { timeout: 60000 }, () => {
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

  async function syncChangesCount() {
    const row = await server.db
      .prepare(`SELECT COUNT(*) AS n FROM sync_changes WHERE vault_id = ?`)
      .bind(vaultId)
      .first<any>();
    return row?.n as number;
  }

  async function vaultCursor() {
    const row = await server.db
      .prepare(`SELECT current_change_seq AS s FROM vaults WHERE vault_id = ?`)
      .bind(vaultId)
      .first<any>();
    return row?.s as number;
  }

  function makeMutation(overrides: Record<string, unknown> = {}) {
    return {
      mutation_id: newMutationId(),
      record_id: newRecordId(),
      expected_revision: 0,
      schema_version: 1,
      key_version: 1,
      is_tombstone: false,
      ciphertext: "idem_ct",
      nonce_b64u: "idem_nonce",
      ...overrides,
    };
  }

  it("identical retry storm (5x same mutation_id + same payload): one revision, one change row, identical results", async () => {
    const mutation = makeMutation();

    const first = await client.postSyncBatch([mutation], creds);
    expect(first.results).toHaveLength(1);
    expect(first.results[0].revision).toBe(1);

    // Storm: 4 more identical submissions (e.g. client timeouts)
    for (let i = 0; i < 4; i++) {
      const retry = await client.postSyncBatch([mutation], creds);
      // Identical cached result — same revision AND same change_seq, no new work
      expect(retry.results).toEqual(first.results);
      expect(retry.new_cursor).toBe(first.new_cursor);
    }

    // No new revisions: exactly one sync_changes row, cursor advanced exactly once
    expect(await syncChangesCount()).toBe(1);
    expect(await vaultCursor()).toBe(1);

    // Pull side confirms a single change event for the record
    const page = await client.getSync(0, 50, creds);
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0].record_id).toBe(mutation.record_id);
    expect(page.changes[0].revision).toBe(1);
  });

  it("identical multi-mutation batch retry returns the cached batch result", async () => {
    const m1 = makeMutation({ ciphertext: "batch_ct_1" });
    const m2 = makeMutation({ ciphertext: "batch_ct_2" });

    const first = await client.postSyncBatch([m1, m2], creds);
    expect(first.results).toHaveLength(2);
    expect(await syncChangesCount()).toBe(2);

    const retry = await client.postSyncBatch([m1, m2], creds);
    expect(retry.results).toEqual(first.results);
    expect(retry.new_cursor).toBe(first.new_cursor);
    expect(await syncChangesCount()).toBe(2);
    expect(await vaultCursor()).toBe(2);
  });

  it("same mutation_id + altered payload returns 409 REPLAY_DETECTED and commits nothing new", async () => {
    const mutation = makeMutation({ ciphertext: "original_ct" });
    await client.postSyncBatch([mutation], creds);
    expect(await syncChangesCount()).toBe(1);

    await expect(
      client.postSyncBatch([{ ...mutation, ciphertext: "altered_payload_ct" }], creds),
    ).rejects.toMatchObject({ code: "REPLAY_DETECTED", httpStatus: 409 });

    // Replay attempt committed nothing: still exactly one change row
    expect(await syncChangesCount()).toBe(1);
    expect(await vaultCursor()).toBe(1);

    // Server still holds the ORIGINAL ciphertext
    const page = await client.getSync(0, 50, creds);
    expect(page.changes[0].ciphertext).toBe("original_ct");
  });

  it("PARTIAL batch retry ([A] committed, then [A, B]): atomic 409, A not doubled, B recoverable", async () => {
    const mutationA = makeMutation({ ciphertext: "A_ct" });
    const mutationB = makeMutation({ ciphertext: "B_ct" });

    // 1. Commit A alone
    const resA = await client.postSyncBatch([mutationA], creds);
    expect(resA.results[0].revision).toBe(1);
    expect(resA.results[0].change_seq).toBe(1);
    expect(await syncChangesCount()).toBe(1);

    // 2. Retry as batch [A (identical), B (new)] — A is already applied, so
    //    the batch cannot commit atomically: whole batch rejects with 409.
    let conflict: any;
    try {
      await client.postSyncBatch([mutationA, mutationB], creds);
    } catch (e) {
      conflict = e;
    }
    expect(conflict).toBeTruthy();
    expect(conflict.code).toBe("REVISION_CONFLICT");
    expect(conflict.httpStatus).toBe(409);
    expect(conflict.data.record_id).toBe(mutationA.record_id);

    // 3. A was NOT double-applied: no new revision, no new change row
    expect(await syncChangesCount()).toBe(1);
    expect(await vaultCursor()).toBe(1);
    const idemRows = await server.db
      .prepare(`SELECT COUNT(*) AS n FROM idempotency_keys WHERE mutation_id = ?`)
      .bind(mutationA.mutation_id)
      .first<any>();
    expect(idemRows?.n).toBe(1);

    // 4. B was NOT lost: submitting B alone still applies cleanly
    const resB = await client.postSyncBatch([mutationB], creds);
    expect(resB.results[0].revision).toBe(1);
    expect(resB.results[0].change_seq).toBe(2);
    expect(await syncChangesCount()).toBe(2);

    const page = await client.getSync(0, 50, creds);
    expect(page.changes).toHaveLength(2);
  });

  it("partial retry with ALTERED A + new B returns REPLAY_DETECTED (not silent overwrite)", async () => {
    const mutationA = makeMutation({ ciphertext: "A_orig" });
    await client.postSyncBatch([mutationA], creds);

    const mutationB = makeMutation({ ciphertext: "B_ct" });
    await expect(
      client.postSyncBatch([{ ...mutationA, ciphertext: "A_tampered" }, mutationB], creds),
    ).rejects.toMatchObject({ code: "REPLAY_DETECTED", httpStatus: 409 });

    // Nothing committed by the tampered batch
    expect(await syncChangesCount()).toBe(1);
  });
});
