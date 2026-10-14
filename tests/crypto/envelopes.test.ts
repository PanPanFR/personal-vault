// @vitest-environment node
import { describe, expect, test } from "vitest";
import { ensureSodium } from "../../src/crypto/wasm-guard";
import {
  createMasterEnvelope,
  unwrapMasterEnvelope,
  createRecoveryEnvelope,
  unwrapRecoveryEnvelope,
} from "../../src/crypto/envelopes";
import { changePassword } from "../../src/vault/lifecycle";

const FAST_CALIBRATE = async () => 100; // skip real 128MiB benchmark in tests

describe("master envelope", () => {
  test("create -> unwrap round-trip", async () => {
    const sodium = await ensureSodium();
    const dek = sodium.randombytes_buf(32);
    const env = await createMasterEnvelope("correct horse battery staple!!!", new Uint8Array(dek), {
      m_kib: 65536,
      t: 3,
      p: 1,
    });
    expect(env).toHaveProperty("salt_b64u");
    expect(env).toHaveProperty("nonce_b64u");
    expect(env).toHaveProperty("wrapped_dek_b64u");
    expect(env.kdf_version).toBe(1);
    expect(env.crypto_format_version).toBe(1);
    const out = await unwrapMasterEnvelope("correct horse battery staple!!!", env);
    expect(sodium.to_hex(out)).toBe(sodium.to_hex(dek));
  });

  test("wrong passphrase fails closed", async () => {
    const sodium = await ensureSodium();
    const dek = sodium.randombytes_buf(32);
    const env = await createMasterEnvelope("right-passphrase-123", new Uint8Array(dek), {
      m_kib: 65536,
      t: 3,
      p: 1,
    });
    await expect(unwrapMasterEnvelope("wrong-passphrase-xyz", env)).rejects.toThrow();
  });

  test("fresh nonce per wrap", async () => {
    const sodium = await ensureSodium();
    const dek = sodium.randombytes_buf(32);
    const a = await createMasterEnvelope("passphrase-one-12345", new Uint8Array(dek), { m_kib: 65536, t: 3, p: 1 });
    const b = await createMasterEnvelope("passphrase-one-12345", new Uint8Array(dek), { m_kib: 65536, t: 3, p: 1 });
    expect(a.nonce_b64u).not.toBe(b.nonce_b64u);
    expect(a.wrapped_dek_b64u).not.toBe(b.wrapped_dek_b64u);
  });
});

describe("recovery envelope", () => {
  test("create -> unwrap round-trip + verifier shape", async () => {
    const sodium = await ensureSodium();
    const dek = sodium.randombytes_buf(32);
    const secret = sodium.randombytes_buf(32);
    const bundle = await createRecoveryEnvelope(new Uint8Array(dek), new Uint8Array(secret));
    expect(bundle.recovery_auth_verifier).toMatch(/^[0-9a-f]{64}$/);
    const out = await unwrapRecoveryEnvelope(new Uint8Array(secret), bundle.envelope);
    expect(sodium.to_hex(out)).toBe(sodium.to_hex(dek));
  });

  test("wrong recovery secret rejects", async () => {
    const sodium = await ensureSodium();
    const dek = sodium.randombytes_buf(32);
    const secret = sodium.randombytes_buf(32);
    const other = sodium.randombytes_buf(32);
    const bundle = await createRecoveryEnvelope(new Uint8Array(dek), new Uint8Array(secret));
    await expect(unwrapRecoveryEnvelope(new Uint8Array(other), bundle.envelope)).rejects.toThrow();
  });
});

describe("password change (master-only re-wrap)", () => {
  test("recovery unwrap still works after password change", async () => {
    const sodium = await ensureSodium();
    const dek = sodium.randombytes_buf(32);
    const secret = sodium.randombytes_buf(32);
    const master = await createMasterEnvelope("old-passphrase-12345", new Uint8Array(dek), {
      m_kib: 65536,
      t: 3,
      p: 1,
    });
    const rec = await createRecoveryEnvelope(new Uint8Array(dek), new Uint8Array(secret));
    const changed = await changePassword({
      oldPassphrase: "old-passphrase-12345",
      newPassphrase: "new-passphrase-67890",
      masterEnvelope: master,
      calibrate: FAST_CALIBRATE,
    });
    // New password opens the new envelope...
    const dek2 = await unwrapMasterEnvelope("new-passphrase-67890", changed.masterEnvelope);
    expect(sodium.to_hex(dek2)).toBe(sodium.to_hex(dek));
    // ...old password no longer opens it...
    await expect(
      unwrapMasterEnvelope("old-passphrase-12345", changed.masterEnvelope),
    ).rejects.toThrow();
    // ...but recovery still unwraps the same DEK (untouched).
    const dek3 = await unwrapRecoveryEnvelope(new Uint8Array(secret), rec.envelope);
    expect(sodium.to_hex(dek3)).toBe(sodium.to_hex(dek));
  }, 120000);
});
