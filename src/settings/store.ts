/**
 * Frozen Settings keys — plan/pwa-hardening-release.md copy-freeze.
 *
 *   lock_timeout   minutes, one of 1 / 5 / 15 / 30 (default 5)   -> app_metadata.preferences
 *   theme          "system" | "light" | "dark"                   -> localStorage `pv-theme`
 *   locale         "en" | "id"                                   -> localStorage `pv-locale`
 *   last_export_at ISO timestamp of the newest encrypted export   -> app_metadata.preferences
 *
 * Non-sensitive UI preferences only: no passphrase, DEK, token or record data
 * ever lands in localStorage (pwa-operational §3.2).
 */
import {
  LOCK_TIMEOUT_DEFAULT,
  LOCK_TIMEOUT_OPTIONS,
  type LockTimeoutMinutes,
} from "../vault/session";
import { LOCALE_STORAGE_KEY, type Locale } from "../i18n/keys";

export const SETTINGS_FIELD_LOCK_TIMEOUT = "lock_timeout" as const;
export const SETTINGS_FIELD_THEME = "theme" as const;
export const SETTINGS_FIELD_LOCALE = "locale" as const;
export const SETTINGS_FIELD_LAST_EXPORT_AT = "last_export_at" as const;

export const THEME_STORAGE_KEY = "pv-theme";
export const PREFERENCES_METADATA_KEY = "preferences";

export type ThemePreference = "system" | "light" | "dark";

export interface Settings {
  lock_timeout: LockTimeoutMinutes;
  theme: ThemePreference;
  locale: Locale;
  last_export_at: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  lock_timeout: LOCK_TIMEOUT_DEFAULT,
  theme: "system",
  locale: "id",
  last_export_at: null,
};

/**
 * Locale default = device locale, fallback ID (plan user decision).
 * Theme default = `prefers-color-scheme` via the "system" value (NOT locale).
 */
export function deviceLocale(fallback: Locale = "id"): Locale {
  if (typeof navigator === "undefined") return fallback;
  const language = navigator.language?.toLowerCase() ?? "";
  return language.startsWith("id") ? "id" : language.startsWith("en") ? "en" : fallback;
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the in-memory preference still applies for this session.
  }
}

export function isLockTimeoutOption(value: unknown): value is LockTimeoutMinutes {
  return (
    typeof value === "number" &&
    (LOCK_TIMEOUT_OPTIONS as readonly number[]).includes(value)
  );
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "id";
}

/** Read the full Settings snapshot from localStorage-backed keys only. */
export function readSettings(): Settings {
  const storedTheme = readLocal(THEME_STORAGE_KEY);
  const storedLocale = readLocal(LOCALE_STORAGE_KEY);
  const storedTimeout = Number(readLocal("pv-lock-timeout"));
  return {
    theme: isThemePreference(storedTheme) ? storedTheme : DEFAULT_SETTINGS.theme,
    locale: isLocale(storedLocale) ? storedLocale : deviceLocale(),
    lock_timeout: isLockTimeoutOption(storedTimeout)
      ? storedTimeout
      : DEFAULT_SETTINGS.lock_timeout,
    last_export_at: readLocal("pv-last-export-at"),
  };
}

export function persistSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  switch (key) {
    case "theme":
      if (!isThemePreference(value)) return;
      writeLocal(THEME_STORAGE_KEY, value);
      return;
    case "locale":
      if (!isLocale(value)) return;
      writeLocal(LOCALE_STORAGE_KEY, value);
      return;
    case "lock_timeout":
      if (!isLockTimeoutOption(value)) return;
      writeLocal("pv-lock-timeout", String(value));
      return;
    case "last_export_at":
      if (value === null) return;
      writeLocal("pv-last-export-at", String(value));
      return;
  }
}

/** Record that an encrypted export was downloaded (iOS banner gate). */
export function markExported(at: Date = new Date()): string {
  const iso = at.toISOString();
  persistSetting("last_export_at", iso);
  return iso;
}

export function needsExportReminder(settings: Settings = readSettings()): boolean {
  return settings.last_export_at === null;
}