// Bilingual ID+EN dictionaries. `t(key)` returns the CURRENT locale.
// Settings switcher writes `pv-locale`; default locale follows the device
// (Indonesian devices → id), falling back to EN.
import { I18N, LOCALE_STORAGE_KEY, type I18nKey, type Locale } from "./keys";

const en: Record<I18nKey, string> = {
  APP_NAME: "Personal Vault",
  DASHBOARD_TITLE: "Dashboard",
  QUICK_ADD: "Quick Add",
  ALL_ITEMS: "All Items",
  FAVORITES: "Favorites",
  LINKS: "Links",
  NOTES: "Notes",
  SNIPPETS: "Snippets",
  CREDENTIALS: "Credentials",
  TAGS: "Tags",
  ARCHIVE: "Archive",
  SETTINGS: "Settings",
  SEARCH_PLACEHOLDER: "Search items...",
  EMPTY_STATE: "No items yet",
  THEME_TOGGLE: "Toggle theme",
  CREATE: "Create",
  SAVE: "Save",
  CANCEL: "Cancel",
  DELETE: "Delete",
  DUPLICATE: "Duplicate",
  FAVORITE: "Favorite",
  ARCHIVE_ACTION: "Archive",
  RESTORE: "Restore",
  REVEAL: "Reveal",
  COPY: "Copy",
  MASKED: "••••••••",
  TAG_INPUT_PLACEHOLDER: "Add tag...",
  TITLE: "Title",
  URL: "URL",
  DESCRIPTION: "Description",
  NOTES_FIELD: "Notes",
  BODY: "Body",
  CONTENT: "Content",
  LANGUAGE: "Language",
  WEBSITE: "Website",
  USERNAME: "Username",
  PASSWORD: "Password",
  EDIT: "Edit",
  VIEW_LIST: "List view",
  VIEW_CARD: "Card view",
  RECENT_ITEMS: "Recent items",
  TAG_FILTERS: "Tag filters",
  NO_RESULTS: "No results",
  CLOSE: "Close",
  BACK: "Back",
  NOT_FOUND_TITLE: "Item not found",
  NOT_FOUND_DESC: "It may have been deleted.",
  CONFIRM_DELETE: "Confirm delete",
  HIDE: "Hide",
  ADD: "Add",
  LOGIN_DESC: "Enter your password to open the vault.",
  LOGIN_PASSWORD_LABEL: "Password",
  LOGIN_WRONG: "Wrong password — try again.",
  LOGIN_BUTTON: "Open vault",
  LOGOUT: "Log out",
  LOCALE_LABEL: "Language / Bahasa",
  SETTINGS_APPEARANCE: "Appearance",
  SETTINGS_THEME_LABEL: "Theme",
  SETTINGS_THEME_SYSTEM: "System (follow device)",
  SETTINGS_THEME_LIGHT: "Light",
  SETTINGS_THEME_DARK: "Dark",
  SETTINGS_ACCOUNT: "Account",
  SETTINGS_ABOUT: "About",
  SETTINGS_VERSION: "Version",
  SETTINGS_PRIVACY:
    "Your items live on your own server and are reachable with your password alone. No analytics, no ads, no third-party scripts.",
};

const id: Record<I18nKey, string> = {
  APP_NAME: "Personal Vault",
  DASHBOARD_TITLE: "Dasbor",
  QUICK_ADD: "Tambah Cepat",
  ALL_ITEMS: "Semua Item",
  FAVORITES: "Favorit",
  LINKS: "Tautan",
  NOTES: "Catatan",
  SNIPPETS: "Cuplikan",
  CREDENTIALS: "Kredensial",
  TAGS: "Tag",
  ARCHIVE: "Arsip",
  SETTINGS: "Pengaturan",
  SEARCH_PLACEHOLDER: "Cari item...",
  EMPTY_STATE: "Belum ada item",
  THEME_TOGGLE: "Ganti tema",
  CREATE: "Buat",
  SAVE: "Simpan",
  CANCEL: "Batal",
  DELETE: "Hapus",
  DUPLICATE: "Duplikat",
  FAVORITE: "Favorit",
  ARCHIVE_ACTION: "Arsipkan",
  RESTORE: "Pulihkan",
  REVEAL: "Tampilkan",
  COPY: "Salin",
  MASKED: "••••••••",
  TAG_INPUT_PLACEHOLDER: "Tambah tag...",
  TITLE: "Judul",
  URL: "URL",
  DESCRIPTION: "Deskripsi",
  NOTES_FIELD: "Catatan",
  BODY: "Isi",
  CONTENT: "Konten",
  LANGUAGE: "Bahasa",
  WEBSITE: "Situs web",
  USERNAME: "Nama pengguna",
  PASSWORD: "Kata sandi",
  EDIT: "Ubah",
  VIEW_LIST: "Tampilan daftar",
  VIEW_CARD: "Tampilan kartu",
  RECENT_ITEMS: "Item terbaru",
  TAG_FILTERS: "Filter tag",
  NO_RESULTS: "Tidak ada hasil",
  CLOSE: "Tutup",
  BACK: "Kembali",
  NOT_FOUND_TITLE: "Item tidak ditemukan",
  NOT_FOUND_DESC: "Mungkin sudah dihapus.",
  CONFIRM_DELETE: "Konfirmasi hapus",
  HIDE: "Sembunyikan",
  ADD: "Tambah",
  LOGIN_DESC: "Masukkan kata sandi untuk membuka brankas.",
  LOGIN_PASSWORD_LABEL: "Kata sandi",
  LOGIN_WRONG: "Kata sandi salah — coba lagi.",
  LOGIN_BUTTON: "Buka brankas",
  LOGOUT: "Keluar",
  LOCALE_LABEL: "Language / Bahasa",
  SETTINGS_APPEARANCE: "Tampilan",
  SETTINGS_THEME_LABEL: "Tema",
  SETTINGS_THEME_SYSTEM: "Sistem (ikuti perangkat)",
  SETTINGS_THEME_LIGHT: "Terang",
  SETTINGS_THEME_DARK: "Gelap",
  SETTINGS_ACCOUNT: "Akun",
  SETTINGS_ABOUT: "Tentang",
  SETTINGS_VERSION: "Versi",
  SETTINGS_PRIVACY:
    "Item Anda tersimpan di server Anda sendiri dan hanya bisa dibuka dengan kata sandi Anda. Tanpa analitik, tanpa iklan, tanpa skrip pihak ketiga.",
};

const DICTS: Record<Locale, Record<I18nKey, string>> = { en, id };

let current: Locale = "en";
try {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  if (stored === "en" || stored === "id") current = stored;
} catch {
  // SSR/tests without localStorage — default EN.
}

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale): void {
  current = locale;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // ignore — memory locale still applies
  }
}

export function t(key: I18nKey, locale?: Locale): string {
  const dict = DICTS[locale ?? current] ?? en;
  return dict[key] ?? en[key] ?? key;
}

export { I18N };
export type { Locale, I18nKey };
