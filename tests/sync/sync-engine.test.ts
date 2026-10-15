// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { SyncApiClient } from "../../src/sync/client";
import { SyncEngine } from "../../src/sync/engine";
import { applyRemoteChanges } from "../../src/sync/download-apply";
import { createDb, type PersonalVaultDB } from "../../src/db/dexie-schema";
import { ensureSodium } from "../../src/crypto/wasm-guard";
import { b64uEncodeSync, sha256Hex } from "../../src/crypto/encoding";
import { newVaultId, newDeviceId, newRecordId, newMutationId } from "../../src/lib/ids";

describe("Client Sync Engine & Conflict Resolution", () => {
  let server: TestServer;
  let client: SyncApiClient;
  let db1: PersonalVaultDB;
  let db2: PersonalVaultDB;
  let sodium: any;

  let vaultId: string;
  let dev1Id: string;
  let dev1Creds: any;
  let dev2Id: string;
  let dev2Creds: any;

  beforeEach(async () => {
    server = new TestServer();
    client = new SyncApiClient("", server.fetch.bind(server) as any);
    sodium = await ensureSodium();

    db1 = createDb(`test-db1-${crypto.randomUUID()}`);
    db2 = createDb(`test-db2-${crypto.randomUUID()}`);

    vaultId = newVaultId();

    // Dev 1
    dev1Id = newDeviceId();
    const rawToken1 = sodium.randombytes_buf(32);
    const tokenB64u1 = b64uEncodeSync(sodium, rawToken1);
    const tokenHash1 = await sha256Hex(new Uint8Array(new TextEncoder().encode(tokenB64u1)));
    const kp1 = sodium.crypto_sign_keypair();
    const pubKey1 = b64uEncodeSync(sodium, kp1.publicKey);
    dev1Creds = { deviceId: dev1Id, rawToken: rawToken1, privateKey: kp1.privateKey };

    // Dev 2
    dev2Id = newDeviceId();
    const rawToken2 = sodium.randombytes_buf(32);
    const tokenB64u2 = b64uEncodeSync(sodium, rawToken2);
    const tokenHash2 = await sha256Hex(new Uint8Array(new TextEncoder().encode(tokenB64u2)));
    const kp2 = sodium.crypto_sign_keypair();
    const pubKey2 = b64uEncodeSync(sodium, kp2.publicKey);
    dev2Creds = { deviceId: dev2Id, rawToken: rawToken2, privateKey: kp2.privateKey };

    // Create vault on server
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
        recovery_auth_verifier: "e".repeat(64),
        device: {
          device_id: dev1Id,
          device_token_hash: tokenHash1,
          device_public_key: pubKey1,
          label: "Device-1",
        },
      }),
    });

    // Register Dev 2 directly into authorized_devices
    const now = new Date().toISOString();
    await server.db
      .prepare(
        `INSERT INTO authorized_devices (vault_id, device_id, token_hash, public_key, label, created_at, last_used_at, revoked_at, last_ack_cursor)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
      )
      .bind(vaultId, dev2Id, tokenHash2, pubKey2, "Device-2", now, now)
      .run();

    // Init app_metadata in both client dbs
    await db1.app_metadata.put({ key: "vault", vault_id: vaultId, schema_version: 1, crypto_format_version: 1 });
    await db1.app_metadata.put({ key: "sync", last_sync_cursor: 0, last_sync_time: null });

    await db2.app_metadata.put({ key: "vault", vault_id: vaultId, schema_version: 1, crypto_format_version: 1 });
    await db2.app_metadata.put({ key: "sync", last_sync_cursor: 0, last_sync_time: null });
  });

  afterEach(async () => {
    server.close();
    await db1.delete();
    await db2.delete();
  });

  it("converges two devices: Device 1 writes item, Device 2 pulls and sees identical item", async () => {
    const recordId = newRecordId();
    const mutationId = newMutationId();
    const nowIso = new Date().toISOString();

    // 1. Device 1 creates an item in Dexie records and queues outbox mutation
    await db1.records.put({
      record_id: recordId,
      ciphertext: "enc_item_dev1",
      nonce: "nonce_dev1",
      schema_version: 1,
      key_version: 1,
      local_revision: 1,
      server_revision: 0,
      sync_state: "pending",
      is_deleted: false,
      updated_at: nowIso,
    });

    await db1.outbox.put({
      mutation_id: mutationId,
      record_id: recordId,
      expected_base_revision: 0,
      action: "upsert",
      encrypted_payload: "enc_item_dev1",
      nonce: "nonce_dev1",
      schema_version: 1,
      key_version: 1,
      created_at: nowIso,
      retry_state: "pending",
      retry_count: 0,
      error_code: null,
    });

    // 2. Device 1 syncs (pushes mutation)
    const engine1 = new SyncEngine(db1, client);
    await engine1.sync(dev1Creds);

    const rec1 = await db1.records.get(recordId);
    expect(rec1?.sync_state).toBe("synced");
    expect(rec1?.server_revision).toBe(1);

    // 3. Device 2 syncs (pulls remote changes)
    const engine2 = new SyncEngine(db2, client);
    await engine2.sync(dev2Creds);

    const rec2 = await db2.records.get(recordId);
    expect(rec2).toBeTruthy();
    expect(rec2?.ciphertext).toBe("enc_item_dev1");
    expect(rec2?.server_revision).toBe(1);
    expect(rec2?.sync_state).toBe("synced");
  });

  it("fault-injection test: crash between record write and cursor commit re-applies cleanly", async () => {
    const recordId = newRecordId();
    const changes = [
      {
        change_seq: 42,
        record_id: recordId,
        revision: 1,
        schema_version: 1,
        key_version: 1,
        is_tombstone: false,
        ciphertext: "fault_injection_ct",
        nonce_b64u: "fault_injection_nonce",
        updated_at: new Date().toISOString(),
      },
    ];

    // Simulate crash: records written, but cursor is NOT advanced (kept at 0)
    await db1.records.put({
      record_id: recordId,
      ciphertext: "fault_injection_ct",
      nonce: "fault_injection_nonce",
      schema_version: 1,
      key_version: 1,
      local_revision: 1,
      server_revision: 1,
      sync_state: "synced",
      is_deleted: false,
      updated_at: changes[0].updated_at,
    });

    const syncMetaBefore = await db1.app_metadata.get("sync");
    expect(syncMetaBefore?.last_sync_cursor).toBe(0);

    // On next sync cycle, changes page with change_seq 42 is re-received and re-applied
    await applyRemoteChanges(db1, changes, 42);

    // Verify record state is intact and clean without corruption
    const record = await db1.records.get(recordId);
    expect(record?.ciphertext).toBe("fault_injection_ct");
    expect(record?.server_revision).toBe(1);

    const syncMetaAfter = await db1.app_metadata.get("sync");
    expect(syncMetaAfter?.last_sync_cursor).toBe(42);
  });

  it("conflict handling: Keep Local as New Item creates fresh UUID and adopts server version", async () => {
    const recordId = newRecordId();

    // 1. Initial record committed on server (rev 1)
    await client.postSyncBatch(
      [
        {
          mutation_id: newMutationId(),
          record_id: recordId,
          expected_revision: 0,
          schema_version: 1,
          key_version: 1,
          is_tombstone: false,
          ciphertext: "initial_server_ct",
          nonce_b64u: "initial_nonce",
        },
      ],
      dev1Creds,
    );

    // 2. Both devices download rev 1
    const engine1 = new SyncEngine(db1, client);
    await engine1.sync(dev1Creds);
    const engine2 = new SyncEngine(db2, client);
    await engine2.sync(dev2Creds);

    // 3. Device 2 updates to rev 2 on server
    await client.postSyncBatch(
      [
        {
          mutation_id: newMutationId(),
          record_id: recordId,
          expected_revision: 1,
          schema_version: 1,
          key_version: 1,
          is_tombstone: false,
          ciphertext: "dev2_edited_ct",
          nonce_b64u: "dev2_nonce",
        },
      ],
      dev2Creds,
    );

    // 4. Device 1 edits offline locally (still based on rev 1)
    const localNow = new Date().toISOString();
    await db1.records.put({
      record_id: recordId,
      ciphertext: "dev1_offline_edit_ct",
      nonce: "dev1_offline_nonce",
      schema_version: 1,
      key_version: 1,
      local_revision: 2,
      server_revision: 1,
      sync_state: "pending",
      is_deleted: false,
      updated_at: localNow,
    });

    await db1.outbox.put({
      mutation_id: newMutationId(),
      record_id: recordId,
      expected_base_revision: 1,
      action: "upsert",
      encrypted_payload: "dev1_offline_edit_ct",
      nonce: "dev1_offline_nonce",
      schema_version: 1,
      key_version: 1,
      created_at: localNow,
      retry_state: "pending",
      retry_count: 0,
      error_code: null,
    });

    // 5. Device 1 syncs -> CAS conflict!
    await engine1.sync(dev1Creds);

    const conflicts = engine1.conflicts.getConflicts();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].record_id).toBe(recordId);
    expect(conflicts[0].serverRevision).toBe(2);

    // 6. User chooses "Keep local as new item"
    const { newRecordId: freshId } = await engine1.conflicts.resolveKeepLocalAsNew(recordId);

    // Fresh record has local edits and is queued for sync
    const freshRec = await db1.records.get(freshId);
    expect(freshRec?.ciphertext).toBe("dev1_offline_edit_ct");
    expect(freshRec?.sync_state).toBe("pending");

    // Original record adopts server version at rev 2
    const origRec = await db1.records.get(recordId);
    expect(origRec?.ciphertext).toBe("dev2_edited_ct");
    expect(origRec?.server_revision).toBe(2);
    expect(origRec?.sync_state).toBe("synced");

    // Conflicts list is now clear
    expect(engine1.conflicts.getConflicts()).toHaveLength(0);

    // Sync again: fresh item uploads to server cleanly as new item
    await engine1.sync(dev1Creds);
    const freshRecAfter = await db1.records.get(freshId);
    expect(freshRecAfter?.sync_state).toBe("synced");
    expect(freshRecAfter?.server_revision).toBe(1);
  });

  it("quota-exhausted mode (503): sync is paused, local vault is usable, outbox is durable", async () => {
    // Custom mock client that returns 503 QUOTA_EXHAUSTED
    const quotaClient = new SyncApiClient("", (async () => {
      return new Response(
        JSON.stringify({
          code: "QUOTA_EXHAUSTED",
          message: "Cloudflare free-tier quota exhausted. Cloud sync paused.",
          retryable: true,
        }),
        { status: 503, headers: { "Content-Type": "application/json" } },
      );
    }) as any);

    const recordId = newRecordId();
    const mutationId = newMutationId();
    const nowIso = new Date().toISOString();

    // Local mutation
    await db1.records.put({
      record_id: recordId,
      ciphertext: "offline_usable_item",
      nonce: "nonce_1",
      schema_version: 1,
      key_version: 1,
      local_revision: 1,
      server_revision: 0,
      sync_state: "pending",
      is_deleted: false,
      updated_at: nowIso,
    });

    await db1.outbox.put({
      mutation_id: mutationId,
      record_id: recordId,
      expected_base_revision: 0,
      action: "upsert",
      encrypted_payload: "offline_usable_item",
      nonce: "nonce_1",
      schema_version: 1,
      key_version: 1,
      created_at: nowIso,
      retry_state: "pending",
      retry_count: 0,
      error_code: null,
    });

    const quotaEngine = new SyncEngine(db1, quotaClient);
    await quotaEngine.sync(dev1Creds);

    const status = await quotaEngine.getStatus();
    expect(status.state).toBe("paused_quota");
    expect(status.lastError).toContain("quota exhausted");

    // Local record is still usable in Dexie!
    const rec = await db1.records.get(recordId);
    expect(rec?.ciphertext).toBe("offline_usable_item");

    // Outbox mutation is still preserved in Dexie!
    const outboxRow = await db1.outbox.get(mutationId);
    expect(outboxRow).toBeTruthy();
    expect(outboxRow?.retry_state).toBe("pending");
  });
});
