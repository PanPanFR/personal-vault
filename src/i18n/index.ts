// Bilingual ID+EN dictionaries. `t(key)` keeps its ui-shell signature and
// returns the CURRENT locale (default EN so existing UI/tests are unchanged).
// Settings switcher writes `pv-locale`; crypto strings freeze here.
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
  SYNC_STATUS: "Sync status",
  NOT_CONNECTED: "Not connected",
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
  DETAILS: "Details",
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
  PASSPHRASE_LABEL: "Master passphrase",
  PASSPHRASE_PLACEHOLDER: "Enter master passphrase",
  PASSPHRASE_MIN_HINT: "Minimum 8 characters — longer is stronger.",
  PASSPHRASE_STRENGTH_WEAK: "Weak passphrase",
  PASSPHRASE_STRENGTH_FAIR: "Fair passphrase",
  PASSPHRASE_STRENGTH_STRONG: "Strong passphrase",
  OFFLINE_GUESS_NOTE:
    "Anyone with your encrypted backup can guess offline — use a long, unique passphrase.",
  UNLOCK: "Unlock",
  LOCK_NOW: "Lock now",
  LOCK_TIMEOUT_LABEL: "Auto-lock after",
  LOCKED_TITLE: "Vault locked",
  LOCKED_DESC: "Enter your passphrase to unlock.",
  WASM_FATAL_TITLE: "Crypto unavailable",
  WASM_FATAL_DESC:
    "Your browser or security policy does not support required cryptographic primitives. Personal Vault cannot operate.",
  RECOVERY_KIT_TITLE: "Recovery kit",
  RECOVERY_KIT_DOWNLOAD: "Download recovery kit",
  RECOVERY_KIT_CONFIRM_LABEL: "I saved my recovery kit offline",
  RECOVERY_KIT_CONFIRMED: "Recovery kit saved",
  RECOVERY_ROTATE_TITLE: "Rotate recovery kit",
  RECOVERY_ROTATE_CONFIRM: "Confirm new kit saved before invalidating the old one",
  PASSWORD_CHANGE_TITLE: "Change master passphrase",
  PASSWORD_CHANGE_DISCLOSURE_OLD_BACKUP:
    "Old backups still open with the old passphrase.",
  PASSWORD_CHANGE_DISCLOSURE_RECOVERY_KEPT:
    "Recovery kit is unchanged and still works.",
  PASSWORD_CHANGE_DISCLOSURE_ROTATE_ADVICE:
    "To fully invalidate the old passphrase, rotate the recovery kit and re-export backups.",
  CLIPBOARD_RETENTION_WARNING:
    "Copied secrets stay in the clipboard until overwritten — paste then clear.",
  CLIPBOARD_COPIED: "Copied to clipboard",
  LOCALE_LABEL: "Language / Bahasa",
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
  SYNC_STATUS: "Status sinkron",
  NOT_CONNECTED: "Tidak terhubung",
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
  DETAILS: "Detail",
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
  PASSPHRASE_LABEL: "Frasa sandi utama",
  PASSPHRASE_PLACEHOLDER: "Masukkan frasa sandi utama",
  PASSPHRASE_MIN_HINT: "Minimal 8 karakter — semakin panjang semakin kuat.",
  PASSPHRASE_STRENGTH_WEAK: "Frasa sandi lemah",
  PASSPHRASE_STRENGTH_FAIR: "Frasa sandi cukup",
  PASSPHRASE_STRENGTH_STRONG: "Frasa sandi kuat",
  OFFLINE_GUESS_NOTE:
    "Siapa pun yang memegang cadangan terenkripsi dapat menebak secara offline — gunakan frasa sandi yang panjang dan unik.",
  UNLOCK: "Buka kunci",
  LOCK_NOW: "Kunci sekarang",
  LOCK_TIMEOUT_LABEL: "Kunci otomatis setelah",
  LOCKED_TITLE: "Brankas terkunci",
  LOCKED_DESC: "Masukkan frasa sandi untuk membuka.",
  WASM_FATAL_TITLE: "Kripto tidak tersedia",
  WASM_FATAL_DESC:
    "Browser atau kebijakan keamanan Anda tidak mendukung primitif kriptografi yang required. Personal Vault tidak dapat beroperasi.",
  RECOVERY_KIT_TITLE: "Kit pemulihan",
  RECOVERY_KIT_DOWNLOAD: "Unduh kit pemulihan",
  RECOVERY_KIT_CONFIRM_LABEL: "Saya sudah menyimpan kit pemulihan secara offline",
  RECOVERY_KIT_CONFIRMED: "Kit pemulihan tersimpan",
  RECOVERY_ROTATE_TITLE: "Rotasi kit pemulihan",
  RECOVERY_ROTATE_CONFIRM: "Konfirmasi kit baru tersimpan sebelum yang lama dinonaktifkan",
  PASSWORD_CHANGE_TITLE: "Ganti frasa sandi utama",
  PASSWORD_CHANGE_DISCLOSURE_OLD_BACKUP:
    "Cadangan lama masih terbuka dengan frasa sandi lama.",
  PASSWORD_CHANGE_DISCLOSURE_RECOVERY_KEPT:
    "Kit pemulihan tidak berubah dan tetap berfungsi.",
  PASSWORD_CHANGE_DISCLOSURE_ROTATE_ADVICE:
    "Untuk sepenuhnya menonaktifkan frasa sandi lama, rotasi kit pemulihan dan ekspor ulang cadangan.",
  CLIPBOARD_RETENTION_WARNING:
    "Rahasia yang disalin tetap di clipboard sampai tertimpa — tempel lalu hapus.",
  CLIPBOARD_COPIED: "Disalin ke clipboard",
  LOCALE_LABEL: "Language / Bahasa",
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
export type { Locale };
