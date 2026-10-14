// @vitest-environment node
import { describe, expect, test, beforeEach } from "vitest";
import {
  clearSession,
  isUnlocked,
  getSession,
  shouldLockOnResume,
  checkResumeLock,
  touchActivity,
} from "../../src/vault/session";
import { createVault, unlockVault, lockVault } from "../../src/vault/lifecycle";
import { validatePassphraseLength } from "../../src/vault/passphrase";

const FAST_CALIBRATE = async () => 100;

describe("passphrase UX rules", () => {
  test("min 8 chars enforced", () => {
    expect(() => validatePassphraseLength("1234567")).toThrow(/PASSPHRASE_TOO_SHORT/);
    expect(() => validatePassphraseLength("12345678")).not.toThrow();
  });
});

describe("vault lifecycle", () => {
  beforeEach(() => {
    clearSession();
  });

  test("create -> lock -> unlock round-trip", async () => {
    const created = await createVault({
      passphrase: "test-passphrase-123",
      apiOrigin: "https://personal-vault.pages.dev",
      calibrate: FAST_CALIBRATE,
    });
    expect(isUnlocked()).toBe(true);
    expect(getSession()?.vaultId).toBe(created.vaultId);
    expect(created.masterEnvelope.argon2_m_kib).toBe(131072); // fast mock -> Recommended
    lockVault();
    expect(isUnlocked()).toBe(false);
    await unlockVault({
      vaultId: created.vaultId,
      passphrase: "test-passphrase-123",
      masterEnvelope: created.masterEnvelope,
    });
    expect(isUnlocked()).toBe(true);
    lockVault();
  }, 120000);

  test("wrong passphrase fails closed, no wipe", async () => {
    const created = await createVault({
      passphrase: "right-passphrase-123",
      apiOrigin: "https://personal-vault.pages.dev",
      calibrate: FAST_CALIBRATE,
    });
    const envelopeBefore = { ...created.masterEnvelope };
    lockVault();
    await expect(
      unlockVault({
        vaultId: created.vaultId,
        passphrase: "wrong-passphrase-xyz",
        masterEnvelope: created.masterEnvelope,
      }),
    ).rejects.toThrow();
    expect(isUnlocked()).toBe(false);
    // Envelope untouched — no wipe of local or cloud material.
    expect(created.masterEnvelope).toEqual(envelopeBefore);
  }, 120000);
});

describe("lock timeouts", () => {
  beforeEach(() => {
    clearSession();
  });

  test("manual lock wipes session", async () => {
    await createVault({
      passphrase: "test-passphrase-123",
      apiOrigin: "https://personal-vault.pages.dev",
      calibrate: FAST_CALIBRATE,
    });
    expect(isUnlocked()).toBe(true);
    lockVault();
    expect(isUnlocked()).toBe(false);
    expect(getSession()).toBeNull();
  }, 60000);

  test("resume check locks after timeout, keeps before", async () => {
    await createVault({
      passphrase: "test-passphrase-123",
      apiOrigin: "https://personal-vault.pages.dev",
      lockTimeoutMinutes: 5,
      calibrate: FAST_CALIBRATE,
    });
    touchActivity(1_000_000);
    expect(shouldLockOnResume(1_000_000 + 4 * 60_000)).toBe(false);
    expect(shouldLockOnResume(1_000_000 + 6 * 60_000)).toBe(true);
    touchActivity(2_000_000);
    expect(checkResumeLock(2_000_000 + 60_000)).toBe(false);
    expect(isUnlocked()).toBe(true);
    expect(checkResumeLock(2_000_000 + 30 * 60_000)).toBe(true);
    expect(isUnlocked()).toBe(false);
  }, 60000);
});
