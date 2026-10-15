// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { SyncApiClient } from "../../src/sync/client";
import { ensureSodium } from "../../src/crypto/wasm-guard";
import { b64uEncodeSync, sha256Hex } from "../../src/crypto/encoding";
import { newVaultId, newDeviceId, newRecordId, newMutationId } from "../../src/lib/ids";

describe("Sync Protocol, CAS & Caps Contract", () => {
  let server: TestServer;
  let client: SyncApiClient;
  let sodium: any;

  let vaultId: string;
  let deviceId: string;
  let rawToken: Uint8Array;
  let keypair: any;
  let creds: any;

  beforeEach(async () => {
    server = new TestServer();
    client = new SyncApiClient("", server.fetch.bind(server) as any);
    sodium = await ensureSodium();

    vaultId = newVaultId();
    deviceId = newDeviceId();
    rawToken = sodium.randombytes_buf(32);
    const tokenB64u = b64uEncodeSync(sodium, rawToken);
    const tokenHash = await sha256Hex(new Uint8Array(new TextEncoder().encode(tokenB64u)));
    keypair = sodium.crypto_sign_keypair();
    const publicKeyB64u = b64uEncodeSync(sodium, keypair.publicKey);

    creds = {
      deviceId,
      rawToken,
      privateKey: keypair.privateKey,
    };

    await server.fetch("/api/v1/vaults", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vault_id: vaultId,
        crypto_format_version: 1,
        key_version: 1,
        schema_version: 1,
        master_envelope: {
          crypto_format_version: 1,
          key_version: 1,
          kdf_version: 1,
          argon2_m_kib: 65536,
          argon2_t: 3,
          argon2_p: 1,
          salt_b64u: "dB8g8jH_839aKdk_23kdPQ",
          nonce_b64u: "rB1Z6k_89qW1rB1Z6k_89qW1rB1Z6k_8",
          wrapped_dek_b64u: "kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0kP0k",
        },
        recovery_envelope: {
          crypto_format_version: 1,
          key_version: 1,
          nonce_b64u: "mN3mN3mN3mN3mN3mN3mN3mN3mN3mN3mN",
          wrapped_dek_b64u: "qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8qZ8q",
        },
        recovery_auth_verifier: "d".repeat(64),
        device: {
          device_id: deviceId,
          device_token_hash: tokenHash,
          device_public_key: publicKeyB64u,
          label: "Device-Sync",
        },
      }),
    });
  });

  afterEach(() => {
    server.close();
  });

  it("applies new record mutation with expected_revision = 0 and advances cursor", async () => {
    const recordId = newRecordId();
    const mutationId = newMutationId();

    const batchRes = await client.postSyncBatch(
      [
        {
          mutation_id: mutationId,
          record_id: recordId,
          expected_revision: 0,
          schema_version: 1,
          key_version: 1,
          is_tombstone: false,
          ciphertext: "U2FsdGVkX1+vupppZksvRf5pq5g5XjFRIipRRM0NZGs",
          nonce_b64u: "dGhpcy1pcy1hLTI0LWJ5dGUtbm9uY2U",
        },
      ],
      creds,
    );

    expect(batchRes.results).toHaveLength(1);
    expect(batchRes.results[0].record_id).toBe(recordId);
    expect(batchRes.results[0].revision).toBe(1);
    expect(batchRes.results[0].change_seq).toBe(1);
    expect(batchRes.new_cursor).toBe(1);

    // Pull changes from cursor = 0
    const page = await client.getSync(0, 50, creds);
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0].record_id).toBe(recordId);
    expect(page.changes[0].revision).toBe(1);
    expect(page.changes[0].is_tombstone).toBe(false);
    expect(page.next_cursor).toBe(1);
  });

  it("detects CAS revision conflict (409 REVISION_CONFLICT) and returns current server state", async () => {
    const recordId = newRecordId();

    // 1. First commit: rev 1
    await client.postSyncBatch(
      [
        {
          mutation_id: newMutationId(),
          record_id: recordId,
          expected_revision: 0,
          schema_version: 1,
          key_version: 1,
          is_tombstone: false,
          ciphertext: "first_ciphertext",
          nonce_b64u: "first_nonce",
        },
      ],
      creds,
    );

    // 2. Second commit advances server rev to 2
    await client.postSyncBatch(
      [
        {
          mutation_id: newMutationId(),
          record_id: recordId,
          expected_revision: 1,
          schema_version: 1,
          key_version: 1,
          is_tombstone: false,
          ciphertext: "second_ciphertext",
          nonce_b64u: "second_nonce",
        },
      ],
      creds,
    );

    // 3. Stale client submits edit expecting rev 1 -> 409 REVISION_CONFLICT
    let conflictErr: any;
    try {
      await client.postSyncBatch(
        [
          {
            mutation_id: newMutationId(),
            record_id: recordId,
            expected_revision: 1, // Stale! Server is at 2
            schema_version: 1,
            key_version: 1,
            is_tombstone: false,
            ciphertext: "stale_ciphertext",
            nonce_b64u: "stale_nonce",
          },
        ],
        creds,
      );
    } catch (e) {
      conflictErr = e;
    }

    expect(conflictErr).toBeTruthy();
    expect(conflictErr.code).toBe("REVISION_CONFLICT");
    expect(conflictErr.httpStatus).toBe(409);
    expect(conflictErr.data.record_id).toBe(recordId);
    expect(conflictErr.data.expected_revision).toBe(1);
    expect(conflictErr.data.server_revision).toBe(2);
    expect(conflictErr.data.server_ciphertext).toBe("second_ciphertext");
    expect(conflictErr.data.server_nonce_b64u).toBe("second_nonce");
  });

  it("ensures batch mutation is atomic: rollback on first conflict, no partial writes", async () => {
    const r1 = newRecordId();
    const r2 = newRecordId();

    // Commit r2 first so its rev is 1
    await client.postSyncBatch(
      [
        {
          mutation_id: newMutationId(),
          record_id: r2,
          expected_revision: 0,
          schema_version: 1,
          key_version: 1,
          is_tombstone: false,
          ciphertext: "r2_ct",
          nonce_b64u: "r2_nonce",
        },
      ],
      creds,
    );

    // Now submit batch with r1 (valid, expected 0) and r2 (conflicting, expected 0 instead of 1)
    await expect(
      client.postSyncBatch(
        [
          {
            mutation_id: newMutationId(),
            record_id: r1,
            expected_revision: 0,
            schema_version: 1,
            key_version: 1,
            is_tombstone: false,
            ciphertext: "r1_ct",
            nonce_b64u: "r1_nonce",
          },
          {
            mutation_id: newMutationId(),
            record_id: r2,
            expected_revision: 0, // Mismatch!
            schema_version: 1,
            key_version: 1,
            is_tombstone: false,
            ciphertext: "r2_conflict",
            nonce_b64u: "r2_conflict_nonce",
          },
        ],
        creds,
      ),
    ).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
      httpStatus: 409,
    });

    // Check that r1 was NOT committed due to atomic rollback
    const page = await client.getSync(1, 50, creds);
    expect(page.changes).toHaveLength(0);
  });

  it("handles tombstones correctly: is_tombstone=true, ciphertext=null, nonce=null", async () => {
    const recordId = newRecordId();

    // Create record
    await client.postSyncBatch(
      [
        {
          mutation_id: newMutationId(),
          record_id: recordId,
          expected_revision: 0,
          schema_version: 1,
          key_version: 1,
          is_tombstone: false,
          ciphertext: "active_ct",
          nonce_b64u: "active_nonce",
        },
      ],
      creds,
    );

    // Delete record (tombstone)
    const delRes = await client.postSyncBatch(
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
      creds,
    );
    expect(delRes.results[0].revision).toBe(2);

    // Fetch changes: tombstone must have null ciphertext and nonce
    const page = await client.getSync(1, 50, creds);
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0].is_tombstone).toBe(true);
    expect(page.changes[0].ciphertext).toBeNull();
    expect(page.changes[0].nonce_b64u).toBeNull();
  });

  it("enforces batch caps: 50 mutations cap and 384 KiB ciphertext cap (413 PAYLOAD_TOO_LARGE)", async () => {
    // 1. > 50 mutations in a batch -> 413 PAYLOAD_TOO_LARGE
    const tooMany = Array.from({ length: 51 }, () => ({
      mutation_id: newMutationId(),
      record_id: newRecordId(),
      expected_revision: 0,
      schema_version: 1,
      key_version: 1,
      is_tombstone: false,
      ciphertext: "test",
      nonce_b64u: "nonce",
    }));

    await expect(client.postSyncBatch(tooMany, creds)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      httpStatus: 413,
    });

    // 2. Ciphertext > 384 KiB -> 413 PAYLOAD_TOO_LARGE
    const oversizedCt = "A".repeat(384 * 1024 + 1);
    await expect(
      client.postSyncBatch(
        [
          {
            mutation_id: newMutationId(),
            record_id: newRecordId(),
            expected_revision: 0,
            schema_version: 1,
            key_version: 1,
            is_tombstone: false,
            ciphertext: oversizedCt,
            nonce_b64u: "nonce",
          },
        ],
        creds,
      ),
    ).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      httpStatus: 413,
    });

    // 3. Ciphertext exactly 384 KiB -> accepted!
    const exactCt = "B".repeat(384 * 1024);
    const exactRes = await client.postSyncBatch(
      [
        {
          mutation_id: newMutationId(),
          record_id: newRecordId(),
          expected_revision: 0,
          schema_version: 1,
          key_version: 1,
          is_tombstone: false,
          ciphertext: exactCt,
          nonce_b64u: "nonce",
        },
      ],
      creds,
    );
    expect(exactRes.results).toHaveLength(1);

    // 4. Verify 384 KiB fits in D1/SQLite row without truncation
    const pulled = await client.getSync(0, 10, creds);
    const bigRow = pulled.changes.find((c) => c.ciphertext?.length === 384 * 1024);
    expect(bigRow).toBeTruthy();
    expect(bigRow?.ciphertext?.length).toBe(384 * 1024);
  });

  it("mutation batch retries are idempotent and do not duplicate revisions", async () => {
    const recordId = newRecordId();
    const mutationId = newMutationId();

    const mutation = {
      mutation_id: mutationId,
      record_id: recordId,
      expected_revision: 0,
      schema_version: 1,
      key_version: 1,
      is_tombstone: false,
      ciphertext: "idempotent_test_ct",
      nonce_b64u: "nonce",
    };

    // 1st submission
    const res1 = await client.postSyncBatch([mutation], creds);
    expect(res1.results[0].revision).toBe(1);
    expect(res1.results[0].change_seq).toBe(1);

    // 2nd identical submission (e.g. client timeout retry)
    const res2 = await client.postSyncBatch([mutation], creds);
    expect(res2.results[0].revision).toBe(1);
    expect(res2.results[0].change_seq).toBe(1);
    expect(res2.new_cursor).toBe(1);

    // Replay with altered payload -> 409 REPLAY_DETECTED
    await expect(
      client.postSyncBatch(
        [
          {
            ...mutation,
            ciphertext: "altered_payload_differing_digest",
          },
        ],
        creds,
      ),
    ).rejects.toMatchObject({
      code: "REPLAY_DETECTED",
      httpStatus: 409,
    });
  });
});
