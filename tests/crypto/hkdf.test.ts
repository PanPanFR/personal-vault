// @vitest-environment node
import { describe, expect, test } from "vitest";
import { ensureSodium } from "../../src/crypto/wasm-guard";
import {
  hkdf,
  hkdfSync,
  HKDF_LABEL_REC_ENC,
  HKDF_LABEL_LOCAL_CRED,
  HKDF_LABEL_RECOVERY_WRAP,
  HKDF_LABEL_RECOVERY_AUTH,
  deriveRecordKey,
  deriveLocalCredKey,
  deriveRecoveryWrapKey,
  deriveRecoveryAuthToken,
} from "../../src/crypto/hkdf";

describe("hkdf domain separation", () => {
  test("4 labels derive distinct 32-byte keys from same IKM", async () => {
    const sodium = await ensureSodium();
    const ikm = sodium.randombytes_buf(32);
    const [a, b, c, d] = [
      hkdfSync(sodium, new Uint8Array(ikm), HKDF_LABEL_REC_ENC, 32),
      hkdfSync(sodium, new Uint8Array(ikm), HKDF_LABEL_LOCAL_CRED, 32),
      hkdfSync(sodium, new Uint8Array(ikm), HKDF_LABEL_RECOVERY_WRAP, 32),
      hkdfSync(sodium, new Uint8Array(ikm), HKDF_LABEL_RECOVERY_AUTH, 32),
    ];
    for (const k of [a, b, c, d]) expect(k.length).toBe(32);
    const hex = [a, b, c, d].map((k) => sodium.to_hex(k));
    expect(new Set(hex).size).toBe(4);
  });

  test("deterministic for same IKM+label", async () => {
    const sodium = await ensureSodium();
    const ikm = sodium.randombytes_buf(32);
    const k1 = hkdfSync(sodium, new Uint8Array(ikm), HKDF_LABEL_REC_ENC, 32);
    const k2 = hkdfSync(sodium, new Uint8Array(ikm), HKDF_LABEL_REC_ENC, 32);
    expect(sodium.to_hex(k1)).toBe(sodium.to_hex(k2));
  });

  test("DEK subkeys differ from recovery-secret subkeys", async () => {
    const dek = await deriveRecordKey(new Uint8Array(32).fill(1));
    const wrap = await deriveRecoveryWrapKey(new Uint8Array(32).fill(1));
    // Same raw bytes as IKM but different labels — must differ.
    expect(Buffer.from(dek).toString("hex")).not.toBe(Buffer.from(wrap).toString("hex"));
  });

  test("helpers return 32 bytes and differ by purpose", async () => {
    const sodium = await ensureSodium();
    const dek = sodium.randombytes_buf(32);
    const rec = await deriveRecordKey(new Uint8Array(dek));
    const cred = await deriveLocalCredKey(new Uint8Array(dek));
    expect(rec.length).toBe(32);
    expect(cred.length).toBe(32);
    expect(sodium.to_hex(rec)).not.toBe(sodium.to_hex(cred));
    const secret = sodium.randombytes_buf(32);
    const w = await deriveRecoveryWrapKey(new Uint8Array(secret));
    const a = await deriveRecoveryAuthToken(new Uint8Array(secret));
    expect(sodium.to_hex(w)).not.toBe(sodium.to_hex(a));
  });

  test("async hkdf matches sync hkdf", async () => {
    const sodium = await ensureSodium();
    const ikm = sodium.randombytes_buf(32);
    const s = hkdfSync(sodium, new Uint8Array(ikm), HKDF_LABEL_REC_ENC, 32);
    const a = await hkdf(new Uint8Array(ikm), HKDF_LABEL_REC_ENC, 32);
    expect(sodium.to_hex(s)).toBe(sodium.to_hex(a));
  });
});
