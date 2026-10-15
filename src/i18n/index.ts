// Bilingual ID+EN dictionaries. `t(key)` keeps its ui-shell signature and
// returns the CURRENT locale (default EN so existing UI/tests are unchanged).
// Settings switcher writes `pv-locale`; crypto strings freeze here.
// pwa-hardening-release APPENDS the Settings/banner/clean-start copy (no renames).
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
  SETTINGS_APPEARANCE: "Appearance",
  SETTINGS_THEME_LABEL: "Theme",
  SETTINGS_THEME_SYSTEM: "System (follow device)",
  SETTINGS_THEME_LIGHT: "Light",
  SETTINGS_THEME_DARK: "Dark",
  SETTINGS_SECURITY: "Security",
  SETTINGS_LOCK_TIMEOUT: "Auto-lock after",
  SETTINGS_LOCK_TIMEOUT_MINUTES: "{n} minutes",
  SETTINGS_STORAGE: "Storage & offline",
  SETTINGS_STORAGE_PERSISTED: "Durable storage granted",
  SETTINGS_STORAGE_BEST_EFFORT:
    "Best-effort storage — the browser may evict data under pressure, or after ~7 days on iOS.",
  SETTINGS_STORAGE_USAGE: "Used",
  SETTINGS_STORAGE_REQUEST: "Request durable storage",
  SETTINGS_STORAGE_EVICTION_NOTE:
    "Local browser storage is a cache, never a backup. Export an encrypted backup file and store it offline.",
  SETTINGS_SYNC: "Cloud sync",
  SETTINGS_SYNC_LAST: "Last sync",
  SETTINGS_SYNC_PENDING: "Pending changes",
  SETTINGS_SYNC_ERROR: "Last error",
  SETTINGS_SYNC_NONE: "Never synced",
  SETTINGS_SYNC_RETRY: "Retry sync",
  SETTINGS_SYNC_NOW: "Sync now",
  SETTINGS_SYNC_OFFLINE_NOTE:
    "Sync runs only in the foreground while unlocked. Offline changes stay queued locally and upload when the connection returns.",
  SETTINGS_DEVICES: "Devices",
  SETTINGS_DEVICES_NONE: "No paired devices recorded.",
  SETTINGS_DEVICE_THIS: "This device",
  SETTINGS_DEVICE_LAST_SEEN: "Last seen",
  SETTINGS_DEVICE_LAST_SEEN_NEVER: "never",
  SETTINGS_DEVICE_RENAME: "Rename",
  SETTINGS_DEVICE_RENAME_SAVED: "Device renamed.",
  SETTINGS_DEVICE_REVOKE: "Revoke",
  SETTINGS_DEVICE_REVOKE_CONFIRM:
    "Revoke this device? It loses API access immediately and must be paired again.",
  SETTINGS_DEVICE_REVOKED: "Device revoked.",
  SETTINGS_BACKUP: "Backup & recovery",
  SETTINGS_EXPORT: "Export encrypted backup",
  SETTINGS_EXPORT_HINT:
    "Downloads one encrypted JSON file with every record plus the key envelopes. Store it offline.",
  SETTINGS_IMPORT: "Import encrypted backup",
  SETTINGS_IMPORT_HINT:
    "Restores an export into this vault. Importing into a vault that already has records never overwrites them silently.",
  SETTINGS_IMPORT_BLOCKED_NONEMPTY:
    "Import paused: this vault is not empty. Confirm explicitly to merge.",
  SETTINGS_RECOVERY_GUIDANCE:
    "If every device is lost, use personal-vault-recovery-kit.json to unwrap the key and re-authorize a device. Without that kit, nobody — including us — can open the vault.",
  SETTINGS_ROTATE_RECOVERY: "Rotate recovery kit",
  SETTINGS_ROTATE_RECOVERY_HINT:
    "Generates a new kit; the old one stops working only after you confirm the new file is saved.",
  SETTINGS_CHANGE_PASSPHRASE: "Change master passphrase",
  SETTINGS_ABOUT: "About",
  SETTINGS_VERSION: "Version",
  SETTINGS_PRIVACY:
    "No analytics, no ads, no third-party scripts. Records are encrypted on this device before storage or sync; the server only ever holds ciphertext it cannot read.",
  SETTINGS_LIMITATIONS: "Limitations",
  SETTINGS_LIMITATIONS_BODY:
    "Not an audited password manager and no browser autofill. No sync while closed or locked. Browser storage can be evicted, so keep an encrypted export offline. Clipboard copies stay until overwritten.",
  BACKUP_BANNER_TITLE: "Export a backup — iOS may clear local data",
  BACKUP_BANNER_BODY:
    "iOS Safari may delete local vault data if the app is not opened for 7 days. Download an encrypted backup to prevent data loss.",
  BACKUP_BANNER_EVICTION_NOTE:
    "Cloud sync keeps the encrypted copy, but unsynced local edits are lost together with local storage.",
  BACKUP_BANNER_EXPORT: "Export now",
  BACKUP_LAST_EXPORT: "Last export",
  CLEAN_START_TITLE_EVICTED: "Local vault data was cleared",
  CLEAN_START_TITLE_FIRST: "Welcome to Personal Vault",
  CLEAN_START_BODY_EVICTED:
    "This browser no longer holds your local vault data (iOS clears it after ~7 days without a visit, or storage was cleared manually). Nothing was corrupted — the encrypted copy in your cloud vault is untouched.",
  CLEAN_START_BODY_FIRST:
    "Set up a new encrypted vault, restore an existing one from a backup file, or pair this device with one you already use.",
  CLEAN_START_RECOVERY: "Restore with Recovery Kit",
  CLEAN_START_PAIR: "Pair with Existing Device",
  CLEAN_START_IMPORT: "Import an encrypted export file",
  CLEAN_START_CREATE: "Create New Vault",
  CLEAN_START_FOOTER:
    "Without an authorized device and valid recovery material, an encrypted vault cannot be opened — that is the security model, not a bug.",
  SW_UPDATED: "App updated — reloaded with the new version.",
  SW_UPDATE_AVAILABLE: "Update ready.",
  SW_APPLY_UPDATE: "Reload to update",
  INSTALL_TITLE: "Install Personal Vault",
  INSTALL_PROMPT_BODY:
    "Run it in its own window and keep the encrypted vault one tap away. The app stays fully usable in this browser tab either way.",
  INSTALL_ACTION: "Install",
  INSTALL_LATER: "Not now",
  INSTALL_IOS_BODY:
    "On iPhone/iPad: tap Share → Add to Home Screen. Until then everything works in Safari — but iOS may clear local data after ~7 days without an app visit, so export a backup regularly.",
  INSTALL_FALLBACK_BODY:
    "No install prompt here — keep using the browser tab; all features work, only offline relaunch needs an installed app.",
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
  SETTINGS_APPEARANCE: "Tampilan",
  SETTINGS_THEME_LABEL: "Tema",
  SETTINGS_THEME_SYSTEM: "Sistem (ikuti perangkat)",
  SETTINGS_THEME_LIGHT: "Terang",
  SETTINGS_THEME_DARK: "Gelap",
  SETTINGS_SECURITY: "Keamanan",
  SETTINGS_LOCK_TIMEOUT: "Kunci otomatis setelah",
  SETTINGS_LOCK_TIMEOUT_MINUTES: "{n} menit",
  SETTINGS_STORAGE: "Penyimpanan & offline",
  SETTINGS_STORAGE_PERSISTED: "Penyimpanan awet diberikan",
  SETTINGS_STORAGE_BEST_EFFORT:
    "Penyimpanan sewaktu-waktu — browser dapat menghapus data saat ruang penuh, atau setelah ~7 hari di iOS.",
  SETTINGS_STORAGE_USAGE: "Terpakai",
  SETTINGS_STORAGE_REQUEST: "Minta penyimpanan awet",
  SETTINGS_STORAGE_EVICTION_NOTE:
    "Penyimpanan lokal browser adalah cache, bukan cadangan. Ekspor cadangan terenkripsi dan simpan secara offline.",
  SETTINGS_SYNC: "Sinkronisasi cloud",
  SETTINGS_SYNC_LAST: "Sinkron terakhir",
  SETTINGS_SYNC_PENDING: "Perubahan tertunda",
  SETTINGS_SYNC_ERROR: "Kesalahan terakhir",
  SETTINGS_SYNC_NONE: "Belum pernah sinkron",
  SETTINGS_SYNC_RETRY: "Coba lagi sinkronisasi",
  SETTINGS_SYNC_NOW: "Sinkron sekarang",
  SETTINGS_SYNC_OFFLINE_NOTE:
    "Sinkronisasi berjalan hanya di latar depan saat brankas terbuka. Perubahan offline tetap antre lokal dan terunggah saat koneksi kembali.",
  SETTINGS_DEVICES: "Perangkat",
  SETTINGS_DEVICES_NONE: "Belum ada perangkat terpasangkan.",
  SETTINGS_DEVICE_THIS: "Perangkat ini",
  SETTINGS_DEVICE_LAST_SEEN: "Terakhir terlihat",
  SETTINGS_DEVICE_LAST_SEEN_NEVER: "tidak pernah",
  SETTINGS_DEVICE_RENAME: "Ganti nama",
  SETTINGS_DEVICE_RENAME_SAVED: "Nama perangkat diganti.",
  SETTINGS_DEVICE_REVOKE: "Cabut akses",
  SETTINGS_DEVICE_REVOKE_CONFIRM:
    "Cabut akses perangkat ini? Akses API langsung hilang dan harus dipasangkan ulang.",
  SETTINGS_DEVICE_REVOKED: "Akses perangkat dicabut.",
  SETTINGS_BACKUP: "Cadangan & pemulihan",
  SETTINGS_EXPORT: "Ekspor cadangan terenkripsi",
  SETTINGS_EXPORT_HINT:
    "Mengunduh satu berkas JSON terenkripsi berisi seluruh item dan amplop kunci. Simpan secara offline.",
  SETTINGS_IMPORT: "Impor cadangan terenkripsi",
  SETTINGS_IMPORT_HINT:
    "Memulihkan cadangan ke brankas ini. Impor ke brankas yang sudah berisi item tidak pernah menimpa diam-diam.",
  SETTINGS_IMPORT_BLOCKED_NONEMPTY:
    "Impor dijeda: brankas ini tidak kosong. Konfirmasi eksplisit untuk menggabungkan.",
  SETTINGS_RECOVERY_GUIDANCE:
    "Jika semua perangkat hilang, gunakan personal-vault-recovery-kit.json untuk membuka kunci dan mengotorisasi ulang perangkat. Tanpa kit itu, tidak ada — termasuk kami — yang dapat membuka brankas.",
  SETTINGS_ROTATE_RECOVERY: "Rotasi kit pemulihan",
  SETTINGS_ROTATE_RECOVERY_HINT:
    "Membuat kit baru; kit lama berhenti berfungsi hanya setelah Anda mengonfirmasi berkas baru tersimpan.",
  SETTINGS_CHANGE_PASSPHRASE: "Ganti frasa sandi utama",
  SETTINGS_ABOUT: "Tentang",
  SETTINGS_VERSION: "Versi",
  SETTINGS_PRIVACY:
    "Tanpa analitik, tanpa iklan, tanpa skrip pihak ketiga. Item dienkripsi di perangkat ini sebelum disimpan atau disinkronkan; server hanya menyimpan ciphertext yang tidak dapat dibaca.",
  SETTINGS_LIMITATIONS: "Keterbatasan",
  SETTINGS_LIMITATIONS_BODY:
    "Bukan pengelola kata sandi teraudit dan tanpa autofill browser. Tidak ada sinkronisasi saat aplikasi ditutup atau terkunci. Penyimpanan browser dapat dihapus, jadi simpan ekspor terenkripsi secara offline. Salinan clipboard bertahan sampai ditimpa.",
  BACKUP_BANNER_TITLE: "Ekspor cadangan — iOS dapat menghapus data lokal",
  BACKUP_BANNER_BODY:
    "Safari iOS dapat menghapus data brankas lokal jika aplikasi tidak dibuka selama 7 hari. Unduh cadangan terenkripsi untuk mencegah kehilangan data.",
  BACKUP_BANNER_EVICTION_NOTE:
    "Sinkronisasi cloud menyimpan salinan terenkripsi, tetapi editan lokal yang belum tersinkron hilang bersama penyimpanan lokal.",
  BACKUP_BANNER_EXPORT: "Ekspor sekarang",
  BACKUP_LAST_EXPORT: "Ekspor terakhir",
  CLEAN_START_TITLE_EVICTED: "Data brankas lokal telah dihapus",
  CLEAN_START_TITLE_FIRST: "Selamat datang di Personal Vault",
  CLEAN_START_BODY_EVICTED:
    "Browser ini tidak lagi menyimpan data brankas lokal Anda (iOS menghapusnya setelah ~7 hari tanpa dibuka, atau penyimpanan dihapus manual). Tidak ada yang rusak — salinan terenkripsi di cloud Anda tetap utuh.",
  CLEAN_START_BODY_FIRST:
    "Siapkan brankas terenkripsi baru, pulihkan dari berkas cadangan, atau pasangkan perangkat ini dengan perangkat yang sudah Anda gunakan.",
  CLEAN_START_RECOVERY: "Pulihkan dengan Kit Pemulihan",
  CLEAN_START_PAIR: "Pasangkan dengan Perangkat Existing",
  CLEAN_START_IMPORT: "Impor berkas ekspor terenkripsi",
  CLEAN_START_CREATE: "Buat Brankas Baru",
  CLEAN_START_FOOTER:
    "Tanpa perangkat terotorisasi dan material pemulihan yang valid, brankas terenkripsi tidak dapat dibuka — itu model keamanannya, bukan bug.",
  SW_UPDATED: "Aplikasi diperbarui — dimuat ulang dengan versi baru.",
  SW_UPDATE_AVAILABLE: "Pembaruan siap.",
  SW_APPLY_UPDATE: "Muat ulang untuk memperbarui",
  INSTALL_TITLE: "Pasang Personal Vault",
  INSTALL_PROMPT_BODY:
    "Jalankan di jendela sendiri dan akses brankas terenkripsi sekali ketuk. Aplikasi tetap bisa dipakai penuh di tab browser ini.",
  INSTALL_ACTION: "Pasang",
  INSTALL_LATER: "Nanti dulu",
  INSTALL_IOS_BODY:
    "Di iPhone/iPad: ketuk Bagikan → Tambah ke Layar Utama. Sampai itu semua tetap jalan di Safari — tetapi iOS dapat menghapus data lokal setelah ~7 hari tanpa dibuka, jadi ekspor cadangan secara rutin.",
  INSTALL_FALLBACK_BODY:
    "Tidak ada prompt pemasangan di sini — tetap gunakan tab browser; semua fitur berfungsi, hanya mulai ulang offline yang memerlukan aplikasi terpasang.",
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

/** Replace `{n}`-style placeholders in a translated string. */
export function tf(key: I18nKey, vars: Record<string, string | number>, locale?: Locale): string {
  return t(key, locale).replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export { I18N };
export type { Locale };