# WASM CSP pin — crypto plan step 1

- `libsodium-wrappers-sumo` pinned EXACT `0.7.15` in `package.json` (no `^`).
  Transitive `libsodium-sumo 0.7.16`.
- Lockfile integrity (pnpm-lock.yaml):
  `libsodium-wrappers-sumo@0.7.15: sha512-aSWY8wKDZh5TC7rMvEdTHoyppVq/1dTSAeAR7H6pzd6QRT3vQWcT5pGwCotLcpPEOLXX6VvqihSPkpEhYAjANA==`
- The sumo build ships the crypto core embedded in
  `dist/modules-sumo/libsodium-wrappers.js`
  (via `libsodium-sumo`), no separate `.wasm` file to hash — Vite bundles it
  into the app chunk. CSP for production must therefore:
  1. include `'wasm-unsafe-eval'` in `script-src` (required for instantiation),
  2. pin the built JS chunk hash (sha256) at deploy time (pwa plan records the
     production chunk hash; any bundle change = new hash).
- Runtime gate: `src/crypto/wasm-guard.ts` — any load failure renders
  `src/components/WasmBlock.tsx` full-screen and refuses ALL vault ops.
  Never falls back to unencrypted/JS crypto.
