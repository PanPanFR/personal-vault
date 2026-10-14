// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  deriveKEK,
  validateArgon2Params,
  calibrateArgon2,
  ARGON2_MIN_M_KIB,
  ARGON2_MAX_M_KIB,
} from "../../src/crypto/argon2";
import { ensureSodium } from "../../src/crypto/wasm-guard";
import vectors from "../fixtures/kdf-vectors.json";

describe("argon2 floor/ceiling guards (no derivation)", () => {
  test.each([
    [32768, 3, 1, "below floor memory"],
    [65536, 2, 1, "below floor iterations"],
    [65536, 3, 0, "below floor parallelism"],
    [1048576, 5, 4, "above ceiling memory"],
    [524288, 6, 4, "above ceiling iterations"],
    [524288, 5, 5, "above ceiling parallelism"],
  ])("rejects m=%i t=%i p=%i (%s) without deriving", (m, t, p) => {
    expect(() => validateArgon2Params(m, t, p)).toThrow(/CRYPTO_VERSION_UNSUPPORTED/);
  });

  test("accepts floor and ceiling boundaries", () => {
    expect(() => validateArgon2Params(65536, 3, 1)).not.toThrow();
    expect(() => validateArgon2Params(524288, 5, 4)).not.toThrow();
    expect(() => validateArgon2Params(131072, 4, 1)).not.toThrow();
  });

  test("deriveKEK rejects out-of-bounds before touching WASM", async () => {
    const salt = new Uint8Array(16);
    await expect(deriveKEK("password123", salt, { m_kib: 32768, t: 3, p: 1 })).rejects.toThrow(
      /CRYPTO_VERSION_UNSUPPORTED/,
    );
    await expect(
      deriveKEK("password123", salt, { m_kib: 1048576, t: 5, p: 4 }),
    ).rejects.toThrow(/CRYPTO_VERSION_UNSUPPORTED/);
  });
});

describe("argon2 KAT vectors", () => {
  for (const v of (vectors as { vectors: Array<{
    profile: string; passphrase: string; salt_b64u: string;
    argon2_m_kib: number; argon2_t: number; argon2_p: number;
    expected_kek_b64u: string;
  }> }).vectors) {
    test(`${v.profile} vector passes`, async () => {
      const sodium = await ensureSodium();
      const salt = sodium.from_base64(v.salt_b64u, sodium.base64_variants.URLSAFE_NO_PADDING);
      const kek = await deriveKEK(v.passphrase, new Uint8Array(salt), {
        m_kib: v.argon2_m_kib,
        t: v.argon2_t,
        p: v.argon2_p,
      });
      const got = sodium.to_base64(kek, sodium.base64_variants.URLSAFE_NO_PADDING);
      expect(got).toBe(v.expected_kek_b64u);
    }, 120000);
  }
});

describe("argon2 calibration", () => {
  test("selects Recommended when benchmark <= 3s", async () => {
    const res = await calibrateArgon2(async () => 1200);
    expect(res.m_kib).toBe(131072);
    expect(res.t).toBe(4);
    expect(res.usedFallback).toBe(false);
  });

  test("auto-fallback to 64MiB/t3 when Recommended > 3s", async () => {
    const res = await calibrateArgon2(async () => 3500);
    expect(res.m_kib).toBe(ARGON2_MIN_M_KIB);
    expect(res.t).toBe(3);
    expect(res.usedFallback).toBe(true);
  });

  test("never weakens below floor or raises above cap", async () => {
    const fast = await calibrateArgon2(async () => 10);
    expect(fast.m_kib).toBeGreaterThanOrEqual(ARGON2_MIN_M_KIB);
    expect(fast.m_kib).toBeLessThanOrEqual(ARGON2_MAX_M_KIB);
    const slow = await calibrateArgon2(async () => 99999);
    expect(slow.m_kib).toBeGreaterThanOrEqual(ARGON2_MIN_M_KIB);
    expect(slow.m_kib).toBeLessThanOrEqual(ARGON2_MAX_M_KIB);
  });
});
