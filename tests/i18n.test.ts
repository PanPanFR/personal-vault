import { describe, expect, test } from "vitest";
import { I18N } from "../src/i18n/keys";
import { t, getLocale, setLocale } from "../src/i18n";

describe("bilingual ID+EN scaffold", () => {
  test("every key has both EN and ID strings", () => {
    const keys = Object.values(I18N);
    expect(keys.length).toBeGreaterThan(50);
    for (const k of keys) {
      expect(t(k, "en")).toBeTruthy();
      expect(t(k, "id")).toBeTruthy();
    }
  });

  test("ID differs from EN for user-facing crypto strings", () => {
    expect(t(I18N.PASSPHRASE_LABEL, "id")).not.toBe(t(I18N.PASSPHRASE_LABEL, "en"));
    expect(t(I18N.OFFLINE_GUESS_NOTE, "id")).not.toBe(t(I18N.OFFLINE_GUESS_NOTE, "en"));
    expect(t(I18N.LOCKED_TITLE, "id")).not.toBe(t(I18N.LOCKED_TITLE, "en"));
  });

  test("locale switch persists and t() follows current", () => {
    const prev = getLocale();
    setLocale("id");
    expect(t(I18N.UNLOCK)).toBe(t(I18N.UNLOCK, "id"));
    setLocale("en");
    expect(t(I18N.UNLOCK)).toBe(t(I18N.UNLOCK, "en"));
    setLocale(prev);
  });

  test("password-change disclosures exist in both locales", () => {
    for (const k of [
      I18N.PASSWORD_CHANGE_DISCLOSURE_OLD_BACKUP,
      I18N.PASSWORD_CHANGE_DISCLOSURE_RECOVERY_KEPT,
      I18N.PASSWORD_CHANGE_DISCLOSURE_ROTATE_ADVICE,
    ] as const) {
      expect(t(k, "en")).toMatch(/./);
      expect(t(k, "id")).toMatch(/./);
    }
  });
});
