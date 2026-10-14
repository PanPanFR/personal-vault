// @vitest-environment node
import { describe, expect, test } from "vitest";
import { ensureSodium } from "../../src/crypto/wasm-guard";
import {
  generateRecoverySecret,
  recoverySecretToB64u,
  recoverySecretFromB64u,
  recoverySecretToBase32,
  recoverySecretFromBase32,
  buildRecoveryKit,
  parseRecoveryKit,
  serializeRecoveryKit,
  RECOVERY_KIT_FORMAT,
  RECOVERY_KIT_VERSION,
} from "../../src/crypto/recovery";

const VAULT = "01J9Z8QK7M3V6P2R5T8W4Y6V1A"; // valid Crockford ULID (no I/L/O/U)

describe("recovery kit", () => {
  test("kit matches Appendix C byte-for-byte + round-trips", async () => {
    const secret = await generateRecoverySecret();
    expect(secret.length).toBe(32);
    const kit = await buildRecoveryKit({
      vault_id: VAULT,
      api_origin: "https://personal-vault.pages.dev",
      recoverySecret: secret,
      created_at: "2026-10-13T00:00:00.000Z",
    });
    expect(kit.format).toBe(RECOVERY_KIT_FORMAT);
    expect(kit.version).toBe(RECOVERY_KIT_VERSION);
    expect(kit.recovery_secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const json = serializeRecoveryKit(kit);
    // Byte-for-byte: key order + no extra whitespace.
    expect(json).toBe(JSON.stringify({
      format: kit.format,
      version: kit.version,
      vault_id: kit.vault_id,
      api_origin: kit.api_origin,
      recovery_secret: kit.recovery_secret,
      created_at: kit.created_at,
      instructions: kit.instructions,
    }));
    const parsed = parseRecoveryKit(JSON.parse(json));
    expect(parsed).toEqual(kit);
  });

  test("base32 fallback round-trips to exact bytes", async () => {
    const sodium = await ensureSodium();
    const secret = sodium.randombytes_buf(32);
    const code = recoverySecretToBase32(new Uint8Array(secret));
    expect(code).toMatch(/^([A-Z2-7]{4}-){12}[A-Z2-7]{4}$/);
    expect(code.replace(/-/g, "").length).toBe(52);
    const back = recoverySecretFromBase32(code);
    expect(sodium.to_hex(back)).toBe(sodium.to_hex(secret));
    // Lowercase + ungrouped input also parses.
    const back2 = recoverySecretFromBase32(code.toLowerCase().replace(/-/g, ""));
    expect(sodium.to_hex(back2)).toBe(sodium.to_hex(secret));
  });

  test("b64u <-> bytes round-trip", async () => {
    const secret = await generateRecoverySecret();
    const s = await recoverySecretToB64u(secret);
    const back = await recoverySecretFromB64u(s);
    const sodium = await ensureSodium();
    expect(sodium.to_hex(back)).toBe(sodium.to_hex(secret));
  });

  test("kit rejects unknown fields and bad values", async () => {
    const secret = await generateRecoverySecret();
    const kit = await buildRecoveryKit({
      vault_id: VAULT,
      api_origin: "https://personal-vault.pages.dev",
      recoverySecret: secret,
    });
    expect(() => parseRecoveryKit({ ...kit, extra: 1 })).toThrow();
    expect(() => parseRecoveryKit({ ...kit, version: 2 })).toThrow(/VERSION_MISMATCH/);
    expect(() => parseRecoveryKit({ ...kit, vault_id: "bad" })).toThrow();
    expect(() => parseRecoveryKit({ ...kit, recovery_secret: "short" })).toThrow();
  });
});
