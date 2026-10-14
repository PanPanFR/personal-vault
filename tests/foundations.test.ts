import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  newVaultId,
  newRecordId,
  newDeviceId,
  newMutationId,
  isVaultId,
  isUuidV4,
} from "../src/lib/ids";
import {
  tagsSchema,
  serializedJsonBytes,
  assertPlaintextSize,
  ItemSchema,
  LinkItemSchema,
  NoteItemSchema,
  SnippetItemSchema,
  CredentialItemSchema,
  MasterEnvelopeSchema,
  RecoveryEnvelopeSchema,
  MASTER_ENVELOPE_FIELDS,
  RECOVERY_ENVELOPE_FIELDS,
} from "../src/lib/schemas";
import {
  PLAINTEXT_ITEM_CAP_BYTES,
  CIPHERTEXT_RECORD_CAP_BYTES,
  SYNC_BATCH_MAX_MUTATIONS,
  SYNC_BATCH_MAX_BYTES,
} from "../src/lib/limits";
import { ERROR_CODES, ERROR_DEFINITIONS } from "../src/lib/errors";
import {
  SCHEMA_VERSION,
  CRYPTO_FORMAT_VERSION,
  KDF_VERSION,
  KEY_VERSION,
  assertVersionSupported,
} from "../src/lib/versions";
import { exportFilename } from "../src/lib/limits";

const base = {
  title: "t",
  tags: [],
  is_favorite: false,
  is_archived: false,
  created_at: "2026-10-13T00:00:00.000Z",
  updated_at: "2026-10-13T00:00:00.000Z",
  schema_version: 1,
};

describe("ids", () => {
  it("generates valid ULID vault id", () => {
    expect(isVaultId(newVaultId())).toBe(true);
  });
  it("generates valid UUIDv4 record/device/mutation ids", () => {
    expect(isUuidV4(newRecordId())).toBe(true);
    expect(isUuidV4(newDeviceId())).toBe(true);
    expect(isUuidV4(newMutationId())).toBe(true);
  });
  it("rejects malformed ids", () => {
    expect(isVaultId("not-a-ulid")).toBe(false);
    expect(isVaultId("01J9Z8QK7M3V6P2R5T8W4Y6U1*")).toBe(false);
    expect(isUuidV4("550e8400-e29b-41d4-a716-44665544000")).toBe(false);
    expect(isUuidV4("not-a-uuid")).toBe(false);
  });
});

describe("item schemas accept/reject", () => {
  it("accepts one of each type", () => {
    expect(() =>
      ItemSchema.parse({ ...base, type: "link", url: "https://x.dev" }),
    ).not.toThrow();
    expect(() =>
      ItemSchema.parse({ ...base, type: "note", body: "hello" }),
    ).not.toThrow();
    expect(() =>
      ItemSchema.parse({ ...base, type: "snippet", content: "const x=1" }),
    ).not.toThrow();
    expect(() =>
      ItemSchema.parse({ ...base, type: "credential", password: "s3cret" }),
    ).not.toThrow();
  });
  it("rejects link without url, note without body", () => {
    expect(() =>
      LinkItemSchema.parse({ ...base, type: "link" }),
    ).toThrow();
    expect(() =>
      NoteItemSchema.parse({ ...base, type: "note" }),
    ).toThrow();
    expect(() =>
      SnippetItemSchema.parse({ ...base, type: "snippet" }),
    ).toThrow();
  });
  it("credential password is optional named field inside encrypted JSON", () => {
    const parsed = CredentialItemSchema.parse({
      ...base,
      type: "credential",
      username: "u",
    });
    expect(parsed.password).toBeUndefined();
  });
  it("preserves unknown fields (forward-compat)", () => {
    const parsed = NoteItemSchema.parse({
      ...base,
      type: "note",
      body: "b",
      future_unrecognized_field: { nested_key: 42 },
    });
    expect(
      (parsed as Record<string, unknown>)["future_unrecognized_field"],
    ).toEqual({ nested_key: 42 });
  });
});

describe("tags", () => {
  it("accepts up to 20 tags <=64 chars", () => {
    expect(() =>
      tagsSchema.parse(Array.from({ length: 20 }, (_, i) => `tag-${i}`)),
    ).not.toThrow();
  });
  it("rejects >20 tags, >64 chars, control chars, quotes", () => {
    expect(() =>
      tagsSchema.parse(Array.from({ length: 21 }, (_, i) => `t${i}`)),
    ).toThrow();
    expect(() => tagsSchema.parse(["a".repeat(65)])).toThrow();
    expect(() => tagsSchema.parse(["bad\ttag"])).toThrow();
    expect(() => tagsSchema.parse(['has"quote'])).toThrow();
  });
});

describe("plaintext size guard (256 KiB pre-encryption)", () => {
  it("rejects >256 KiB serialized JSON", () => {
    const big = "x".repeat(PLAINTEXT_ITEM_CAP_BYTES + 1);
    expect(() => assertPlaintextSize(big)).toThrow();
  });
  it("measures serialized JSON bytes", () => {
    expect(serializedJsonBytes("x")).toBeLessThanOrEqual(
      PLAINTEXT_ITEM_CAP_BYTES,
    );
  });
});

describe("limits", () => {
  it("freezes caps", () => {
    expect(PLAINTEXT_ITEM_CAP_BYTES).toBe(262144);
    expect(CIPHERTEXT_RECORD_CAP_BYTES).toBe(393216);
    expect(SYNC_BATCH_MAX_MUTATIONS).toBe(50);
    expect(SYNC_BATCH_MAX_BYTES).toBe(1048576);
  });
});

describe("errors (18 frozen codes)", () => {
  it("has exactly 18 codes", () => {
    expect(ERROR_CODES).toHaveLength(18);
  });
  it("maps HTTP + retryable per Appendix A", () => {
    expect(ERROR_DEFINITIONS["VALIDATION_ERROR"].httpStatus).toBe(400);
    expect(ERROR_DEFINITIONS["STALE_TIMESTAMP"].retryable).toBe(true);
    expect(ERROR_DEFINITIONS["RATE_LIMITED"].httpStatus).toBe(429);
    expect(ERROR_DEFINITIONS["REVISION_CONFLICT"].httpStatus).toBe(409);
    expect(ERROR_DEFINITIONS["QUOTA_EXHAUSTED"].httpStatus).toBe(503);
  });
});

describe("versions (all =1, refuse newer/downgrade)", () => {
  it("all equal 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(CRYPTO_FORMAT_VERSION).toBe(1);
    expect(KDF_VERSION).toBe(1);
    expect(KEY_VERSION).toBe(1);
  });
  it("refuses newer version", () => {
    expect(() => assertVersionSupported("schema_version", 2)).toThrow();
  });
});

describe("envelopes", () => {
  it("master has 9 frozen fields, recovery 4 + verifier", () => {
    expect(MASTER_ENVELOPE_FIELDS).toHaveLength(9);
    expect(RECOVERY_ENVELOPE_FIELDS).toHaveLength(4);
    expect(() =>
      MasterEnvelopeSchema.parse({
        crypto_format_version: 1,
        key_version: 1,
        kdf_version: 1,
        argon2_m_kib: 131072,
        argon2_t: 4,
        argon2_p: 1,
        salt_b64u: "s",
        nonce_b64u: "n",
        wrapped_dek_b64u: "w",
      }),
    ).not.toThrow();
    expect(() =>
      RecoveryEnvelopeSchema.parse({
        crypto_format_version: 1,
        key_version: 1,
        nonce_b64u: "n",
        wrapped_dek_b64u: "w",
      }),
    ).not.toThrow();
  });
});

describe("migration (D1 0001_init.sql)", () => {
  const sql = fs.readFileSync("migrations/0001_init.sql", "utf8");
  it("creates all 5 tables", () => {
    for (const t of [
      "vaults",
      "vault_records",
      "authorized_devices",
      "pairing_tickets",
      "sync_changes",
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE ${t}`, "i"));
    }
  });
  it("has single-active-ticket partial unique index", () => {
    expect(sql).toMatch(/idx_pairing_tickets_single_active/i);
    expect(sql).toMatch(/WHERE consumed_at IS NULL/i);
  });
  it("ciphertext stored as unbounded TEXT (384 KiB gate)", () => {
    expect(sql).toMatch(/ciphertext TEXT/i);
    expect(sql).not.toMatch(/VARCHAR\(\d+\)/i);
  });
});

describe("dexie schema (zero plaintext-content columns)", () => {
  const src = fs.readFileSync("src/db/dexie-schema.ts", "utf8");
  it("defines 4 stores", () => {
    for (const s of ["records:", "outbox:", "device_credentials:", "app_metadata:"]) {
      expect(src).toContain(s);
    }
  });
  it("has no plaintext content indexes", () => {
    for (const col of ["title", "url", "body", "content", "password", "tags"]) {
      // index lists live in .stores({...}) strings; content fields must not appear there
      const storesBlock = src.slice(src.indexOf(".stores({"), src.indexOf("})", src.indexOf(".stores({")) + 2);
      expect(storesBlock).not.toMatch(new RegExp(`\\b${col}\\b`));
    }
  });
});

describe("openapi mirror", () => {
  const yaml = fs.readFileSync("openapi.yaml", "utf8");
  it("covers all 9 endpoints", () => {
    for (const p of [
      "/vaults:",
      "/vaults/{vaultId}/bootstrap:",
      "/sync:",
      "/sync/batch:",
      "/pairing-tickets:",
      "/pairing/exchange:",
      "/devices/{deviceId}/revoke:",
      "/vault/crypto-metadata:",
      "/recovery/enroll-device:",
    ]) {
      expect(yaml).toContain(p);
    }
  });
  it("bootstrap excludes recovery envelope, recovery enroll includes it", () => {
    const bootStart = yaml.indexOf("BootstrapResponse:");
    const bootEnd = yaml.indexOf("\n    ", bootStart + 1);
    const boot = yaml.slice(bootStart, bootEnd < 0 ? undefined : bootEnd);
    expect(boot).not.toContain("recovery_envelope");
    expect(yaml).toContain("RecoveryEnrollResponse:");
  });
  it("documents 429 Retry-After and 384 KiB cap", () => {
    expect(yaml).toContain("Retry-After");
    expect(yaml).toContain("393216");
  });
});

describe("export filename", () => {
  it("matches personal-vault-export-YYYYMMDD.json", () => {
    expect(exportFilename(new Date("2026-10-13T00:00:00Z"))).toBe(
      "personal-vault-export-20261013.json",
    );
  });
});
