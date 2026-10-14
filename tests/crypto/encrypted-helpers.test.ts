// @vitest-environment node
import { describe, expect, test, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { createDb } from "../../src/db/dexie-schema";
import {
  saveEncryptedRecord,
  loadDecryptedRecord,
  stageEncryptedOutbox,
  wrapLocalBytes,
  unwrapLocalBytes,
  saveDeviceCredentials,
  loadDeviceToken,
  loadDevicePrivateKey,
} from "../../src/db/encrypted-helpers";
import { ensureSodium } from "../../src/crypto/wasm-guard";
import { deriveRecordKey, deriveLocalCredKey } from "../../src/crypto/hkdf";

describe("encrypted IndexedDB helpers (ciphertext-only at rest)", () => {
  let db: ReturnType<typeof createDb>;
  beforeEach(async () => {
    db = createDb(`test-${Math.random().toString(36).slice(2)}`);
    await db.open();
  });

  test("record save/load round-trip, no plaintext in row", async () => {
    const sodium = await ensureSodium();
    const dek = sodium.randombytes_buf(32);
    const recKey = await deriveRecordKey(new Uint8Array(dek));
    const vaultId = "01J9Z8QK7M3V6P2R5T8W4Y6V1A";
    const recordId = "550e8400-e29b-41d4-a716-446655440000";
    const item = {
      schema_version: 1,
      type: "credential",
      title: "Bank",
      username: "user1",
      password: "s3cr3t!",
      tags: [],
      is_favorite: false,
      is_archived: false,
      created_at: "2026-10-14T00:00:00.000Z",
      updated_at: "2026-10-14T00:00:00.000Z",
    };
    await saveEncryptedRecord(db, {
      vaultId,
      recEncKey: recKey,
      keyVersion: 1,
      record_id: recordId,
      plaintext: item,
      schema_version: 1,
      updated_at: item.updated_at,
      localRevision: 1,
      serverRevision: 0,
      syncState: "pending",
      isDeleted: false,
    });
    const row = await db.records.get(recordId);
    expect(row).toBeDefined();
    const raw = JSON.stringify(row);
    // No plaintext leaks into the stored row.
    for (const secret of ["Bank", "user1", "s3cr3t!"]) {
      expect(raw).not.toContain(secret);
    }
    const back = await loadDecryptedRecord<Record<string, unknown>>(db, recordId, vaultId, recKey);
    expect(back).toEqual(item);
    db.close();
  });

  test("outbox stages ciphertext (same REC-ENC purpose)", async () => {
    const sodium = await ensureSodium();
    const dek = sodium.randombytes_buf(32);
    const recKey = await deriveRecordKey(new Uint8Array(dek));
    const item = { schema_version: 1, type: "note", title: "t", body: "hello" };
    await stageEncryptedOutbox({
      db,
      mutation_id: "11111111-1111-4111-8111-111111111111",
      record_id: "550e8400-e29b-41d4-a716-446655440000",
      expected_base_revision: 0,
      action: "upsert",
      plaintext: item,
      vaultId: "01J9Z8QK7M3V6P2R5T8W4Y6V1A",
      recEncKey: recKey,
      schema_version: 1,
      keyVersion: 1,
    });
    const rows = await db.outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain("hello");
    db.close();
  });

  test("device token + private key wrapped under LOCAL-CRED", async () => {
    const sodium = await ensureSodium();
    const dek = sodium.randombytes_buf(32);
    const credKey = await deriveLocalCredKey(new Uint8Array(dek));
    const token = sodium.randombytes_buf(32);
    const priv = sodium.randombytes_buf(64);
    await saveDeviceCredentials({
      db,
      device_id: "22222222-2222-4222-8222-222222222222",
      rawToken: new Uint8Array(token),
      rawPrivateKey: new Uint8Array(priv),
      publicKeyB64u: "cGxhY2Vob2xkZXI",
      label: "Device-ABCD",
      localCredKey: credKey,
    });
    const row = await db.device_credentials.get("22222222-2222-4222-8222-222222222222");
    expect(row).toBeDefined();
    expect(JSON.stringify(row)).not.toContain(sodium.to_hex(token));
    const backToken = await loadDeviceToken(db, "22222222-2222-4222-8222-222222222222", credKey);
    const backPriv = await loadDevicePrivateKey(db, "22222222-2222-4222-8222-222222222222", credKey);
    expect(sodium.to_hex(backToken)).toBe(sodium.to_hex(token));
    expect(sodium.to_hex(backPriv)).toBe(sodium.to_hex(priv));
    db.close();
  });

  test("local wrap uses fresh nonces", async () => {
    const sodium = await ensureSodium();
    const dek = sodium.randombytes_buf(32);
    const credKey = await deriveLocalCredKey(new Uint8Array(dek));
    const raw = sodium.randombytes_buf(32);
    const a = await wrapLocalBytes(new Uint8Array(raw), credKey);
    const b = await wrapLocalBytes(new Uint8Array(raw), credKey);
    expect(a.nonce_b64u).not.toBe(b.nonce_b64u);
    const back = await unwrapLocalBytes(a.wrapped_b64u, a.nonce_b64u, credKey);
    expect(sodium.to_hex(back)).toBe(sodium.to_hex(raw));
  });
});
