import { describe, expect, test } from "vitest";
import { I18N } from "../src/i18n/keys";
import { t, getLocale, setLocale } from "../src/i18n";

describe("bilingual ID+EN dictionaries", () => {
  test("every key has both EN and ID strings", () => {
    const keys = Object.values(I18N);
    expect(keys.length).toBeGreaterThan(50);
    for (const k of keys) {
      expect(t(k, "en")).toBeTruthy();
      expect(t(k, "id")).toBeTruthy();
    }
  });

  test("ID differs from EN for user-facing strings", () => {
    expect(t(I18N.LOGIN_BUTTON, "id")).not.toBe(t(I18N.LOGIN_BUTTON, "en"));
    expect(t(I18N.LOGIN_WRONG, "id")).not.toBe(t(I18N.LOGIN_WRONG, "en"));
    expect(t(I18N.SETTINGS_PRIVACY, "id")).not.toBe(t(I18N.SETTINGS_PRIVACY, "en"));
  });

  test("locale switch persists and t() follows current", () => {
    const prev = getLocale();
    setLocale("id");
    expect(t(I18N.LOGOUT)).toBe(t(I18N.LOGOUT, "id"));
    setLocale("en");
    expect(t(I18N.LOGOUT)).toBe(t(I18N.LOGOUT, "en"));
    setLocale(prev);
  });
});
