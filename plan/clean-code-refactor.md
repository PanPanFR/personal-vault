# Plan: clean-code pass — personal-vault

Goal: codebase rapi tanpa mengubah perilaku. Branch: `feature/clean-code-refactor` (dari `main` @ 3bad0c7).
Scope disetujui user: **shared items store + ESLint + CI release gate** (Jev verify pick P=1.0/conf=1.0).

## Ground rules
- Tidak ada perubahan perilaku produk (kecuali fix bug yang ditandai "BUG FIX").
- Setiap langkah: `pnpm typecheck` + `pnpm test` hijau, lalu commit.
- Tidak menyentuh pipeline deploy (`wrangler pages functions build`, `main = .wrangler/worker/index.js`) — itu jalan produksi.

## Step 1 — Tooling & CI (P0)
- [ ] Restore `scripts/verify-prod-build.mjs` (versi lama di `9090ad7^`, disesuaikan: hapus asumsi wasm/sync-batch, cek CSP simple-vault + no-store `/api/*` + precache allowlist + no remote runtime dep).
- [ ] `package.json`: tambah script `verify:prod`; `lint` → ESLint (Step 6), `typecheck` tetap.
- [ ] Hapus `.github/workflows/contract.yml` (script + `src/db/**` + `openapi.yaml` sudah dihapus).
- [ ] Komentar/docs basi: README ("Cloudflare Pages" → Workers), `public/_headers`, `migrations/0001_init.sql` (ULID → UUIDv4), `tests/helpers/test-harness.ts`.

## Step 2 — Dead code & duplikasi (P1)
- [ ] `src/lib/bytes.ts`: satu helper ukuran UTF-8/JSON; pakai di `schemas.ts` + `validators.ts`.
- [ ] Hapus `schemas.validateTags` (mati, nama bentrok dgn `validators.validateTags`).
- [ ] Hapus `ids.isUuidV4` / `ids.isRecordId` (mati).
- [ ] `validators.newId` — fallback didokumentasikan.

## Step 3 — Satu store untuk items (P1)
- [ ] `src/hooks/useItems.ts`: module-level store `useSyncExternalStore` (pola `src/sw-update.ts`), API hook tetap sama.
- [ ] `__resetItemsStore()` test seam + `tests/ui/useItems.test.tsx` beforeEach.
- [ ] `useTags` → `useMemo`; `ItemsView` filter → `useMemo`.

## Step 4 — Duplikasi UI (P2)
- [ ] `src/components/TagChip.tsx` (Dashboard/Tags/ItemsView).
- [ ] `src/components/ItemGrid.tsx` (Dashboard x2/Tags/ItemsView).
- [ ] `ItemCard`: peta warna ke module scope + tipe `Record<ItemType, string>`.
- [ ] 4 halaman tipe (Links/Notes/Snippets/Credentials) → 1 `TypeItems` + props route.

## Step 5 — Logika & konsistensi (P2)
- [ ] BUG FIX `search.ts`: token `AND` jadi no-op (sekarang nyari literal "and"); hapus chip `created:`/`updated:` yang tak didukung (+ update test).
- [ ] `search.ts`: buang `as any` — helper `searchableText` bertipe union.
- [ ] BUG FIX i18n: pilihan EN eksplisit tidak hilang saat reload; locale default = device locale.
- [ ] `useTheme`: validasi nilai `pv-theme` dari localStorage.
- [ ] `src/index.css`: hapus duplikasi palet dark (`.dark` + `@media prefers-color-scheme`).
- [ ] `ItemDetail` → pecah view per tipe ke `src/components/ItemBody.tsx`.

## Step 6 — Linter beneran (P1)
- [ ] Tambah devDeps: eslint@9, @eslint/js, typescript-eslint, eslint-plugin-react-hooks.
- [ ] `eslint.config.js` flat config; `pnpm lint` = eslint.
- [ ] Hapus directive `eslint-disable` basi di `validators.ts`.
- [ ] Fix semua temuan.

## Step 7 — Verifikasi
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` / `node scripts/verify-prod-build.mjs` hijau.
- [ ] Reviewer gate (jev review: security risk = HIGH → reviewer subagent).
- [ ] Hapus file plan ini setelah semua hijau.
