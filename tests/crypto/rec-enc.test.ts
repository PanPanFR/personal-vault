// @vitest-environment node
import { describe, expect, test } from "vitest";
import { ensureSodium } from "../../src/crypto/wasm-guard";
import { encryptRecord, decryptRecord } from "../../src/crypto/rec-enc";
import { deriveRecordKey } from "../../src/crypto/hkdf";

const VAULT = "01J9Z8QK7M3V6P2R5T8W4Y6U1A";
const RECORD = "550e8400-e29b-41d4-a716-446655440000";

async function testKey(): Promise<Uint8Array> {
  const sodium = await ensureSodium();
  const dek = sodium.randombytes_buf(32);
  return deriveRecordKey(new Uint8Array(dek));
}

describe("record encrypt/decrypt", () => {
  test("round-trip preserves payload including unknown future fields", async () => {
    const key = await testKey();
    const payload = {
      schema_version: 1,
      type: "note",
      title: "Forward Compatibility Test",
      body: "Payload with unknown future field.",
      future_unrecognized_field: { nested_key: 42, flag: true },
    };
    const enc = await encryptRecord(payload, key, VAULT, RECORD, 1, 1);
    const dec = await decryptRecord<Record<string, unknown>>(
      enc.ciphertext_b64u,
      enc.nonce_b64u,
      key,
      VAULT,
      RECORD,
      1,
      1,
    );
    expect(dec).toEqual(payload);
    // Edit + re-encrypt keeps the unknown field (forward-compat).
    const edited = { ...(dec as object), title: "Edited" } as Record<string, unknown>;
    const enc2 = await encryptRecord(edited, key, VAULT, RECORD, 1, 1);
    const dec2 = await decryptRecord<Record<string, unknown>>(
      enc2.ciphertext_b64u,
      enc2.nonce_b64u,
      key,
      VAULT,
      RECORD,
      1,
      1,
    );
    expect((dec2 as Record<string, unknown>).future_unrecognized_field).toEqual({
      nested_key: 42,
      flag: true,
    });
  });

  test("fresh nonce every encryption", async () => {
    const key = await testKey();
    const payload = { schema_version: 1, type: "note", title: "n", body: "b" };
    const nonces = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const enc = await encryptRecord(payload, key, VAULT, RECORD, 1, 1);
      expect(nonces.has(enc.nonce_b64u)).toBe(false);
      nonces.add(enc.nonce_b64u);
    }
    expect(nonces.size).toBe(10);
  });

  test.each([
    ["AAD-FAIL-1 vault_id", { vault: "01J9Z8QK7M3V6P2R5T8W4Y6U1B", record: RECORD, sv: 1, kv: 1 }],
    ["AAD-FAIL-2 record_id", { vault: VAULT, record: "550e8400-e29b-41d4-a716-446655440001", sv: 1, kv: 1 }],
    ["AAD-FAIL-3 schema_version", { vault: VAULT, record: RECORD, sv: 2, kv: 1 }],
    ["AAD-FAIL-4 key_version", { vault: VAULT, record: RECORD, sv: 1, kv: 2 }],
  ])("AAD mismatch rejects: %s", async (_name, alt) => {
    const key = await testKey();
    const payload = { schema_version: 1, type: "note", title: "t", body: "b" };
    const enc = await encryptRecord(payload, key, VAULT, RECORD, 1, 1);
    await expect(
      decryptRecord(enc.ciphertext_b64u, enc.nonce_b64u, key, alt.vault, alt.record, alt.sv, alt.kv),
    ).rejects.toThrow();
  });

  test("AAD-FAIL-5 wrong purpose rejects", async () => {
    const sodium = await ensureSodium();
    const key = await testKey();
    const payload = { schema_version: 1, type: "note", title: "t", body: "b" };
    const enc = await encryptRecord(payload, key, VAULT, RECORD, 1, 1);
    // Re-encrypt same bytes under purpose "records" manually, then decrypt
    // with the record path must fail (purpose is AAD-bound).
    const cipher = sodium.from_base64(enc.ciphertext_b64u, sodium.base64_variants.URLSAFE_NO_PADDING);
    void cipher;
    // Simulate by decrypting with a tampered AAD: our decryptRecord always
    // uses purpose "record", so craft a ciphertext bound to "records" here.
    const plain = new TextEncoder().encode(JSON.stringify(payload));
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const wrongAad = new TextEncoder().encode(`${VAULT}${RECORD}11records`);
    const wrongCipher = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plain,
      wrongAad,
      null,
      nonce,
      key,
    );
    const wrongB64 = sodium.to_base64(wrongCipher, sodium.base64_variants.URLSAFE_NO_PADDING);
    const nonceB64 = sodium.to_base64(nonce, sodium.base64_variants.URLSAFE_NO_PADDING);
    await expect(decryptRecord(wrongB64, nonceB64, key, VAULT, RECORD, 1, 1)).rejects.toThrow();
  });

  test("tampered ciphertext rejects, no plaintext", async () => {
    const sodium = await ensureSodium();
    const key = await testKey();
    const enc = await encryptRecord({ schema_version: 1, type: "note", title: "t", body: "b" }, key, VAULT, RECORD, 1, 1);
    const bytes = sodium.from_base64(enc.ciphertext_b64u, sodium.base64_variants.URLSAFE_NO_PADDING);
    bytes[0] ^= 0xff;
    const tampered = sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
    await expect(decryptRecord(tampered, enc.nonce_b64u, key, VAULT, RECORD, 1, 1)).rejects.toThrow();
  });

  test("bad nonce length rejects safely", async () => {
    const sodium = await ensureSodium();
    const key = await testKey();
    const enc = await encryptRecord({ schema_version: 1, type: "note", title: "t", body: "b" }, key, VAULT, RECORD, 1, 1);
    const shortNonce = sodium.to_base64(new Uint8Array(8), sodium.base64_variants.URLSAFE_NO_PADDING);
    await expect(
      decryptRecord(enc.ciphertext_b64u, shortNonce, key, VAULT, RECORD, 1, 1),
    ).rejects.toThrow();
  });

  test("higher schema_version refuses with VERSION_MISMATCH (no write-back)", async () => {
    const key = await testKey();
    const enc = await encryptRecord({ schema_version: 1, type: "note", title: "t", body: "b" }, key, VAULT, RECORD, 1, 1);
    await expect(
      decryptRecord(enc.ciphertext_b64u, enc.nonce_b64u, key, VAULT, RECORD, 2, 1),
    ).rejects.toThrow(/VERSION_MISMATCH/);
  });

  test("256 KiB plaintext guard agrees with server cap", async () => {
    const key = await testKey();
    const big = { schema_version: 1, type: "note", title: "t", body: "x".repeat(300 * 1024) };
    await expect(encryptRecord(big, key, VAULT, RECORD, 1, 1)).rejects.toThrow();
  });
});
