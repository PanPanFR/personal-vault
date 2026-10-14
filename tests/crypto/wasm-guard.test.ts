// @vitest-environment node
import { describe, expect, test, beforeEach } from "vitest";
import {
  ensureSodium,
  isCryptoFailed,
  __resetWasmGate,
  __forceWasmFailure,
} from "../../src/crypto/wasm-guard";
import { generateDEK } from "../../src/crypto/dek";

describe("wasm fatal gate", () => {
  beforeEach(() => {
    __resetWasmGate();
  });

  test("crypto loads in a healthy environment", async () => {
    const sodium = await ensureSodium();
    expect(isCryptoFailed()).toBe(false);
    expect(typeof sodium.crypto_aead_xchacha20poly1305_ietf_encrypt).toBe("function");
  });

  test("forced failure blocks all vault ops", async () => {
    __forceWasmFailure();
    expect(isCryptoFailed()).toBe(true);
    await expect(ensureSodium()).rejects.toThrow();
    await expect(generateDEK()).rejects.toThrow();
    __resetWasmGate();
    // Gate recovers after reset (fresh page load).
    const sodium = await ensureSodium();
    expect(isCryptoFailed()).toBe(false);
    expect(!!sodium).toBe(true);
  });
});
