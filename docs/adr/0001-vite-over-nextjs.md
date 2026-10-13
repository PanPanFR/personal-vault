# 0001. Vite SPA over Next.js for Local-First PWA

- **Status:** Accepted
- **Date:** 2026-10-13
- **Authoritative Source:** `personal-vault-prd-v3.md` §2 (Decision 1), §6 (Recommended technology stack), §18 (Gap fix 7)

---

## Context

Personal Vault is a single-owner personal information vault built as an installable Progressive Web App (PWA) targeting Windows, Android, iOS/iPadOS, and desktop/mobile web browsers.

A primary technology choice is the frontend framework and bundler runtime. Modern web applications frequently default to full-stack frameworks like Next.js (with React Server Components, Server-Side Rendering, and dynamic Node.js/Edge server runtimes). We evaluated whether Next.js or a client-centric single-page application (SPA) built with Vite and React is the appropriate foundation for Personal Vault.

Key constraints:
1. **Client-Side Encryption:** All vault contents are encrypted client-side using WebAssembly (`libsodium-wrappers-sumo`). The server possesses no master passphrase or data encryption keys and cannot decrypt or render record content.
2. **Local-First & Offline Resilience:** The application must operate offline after initial bootstrap. The client reads, writes, searches, and manages records locally in IndexedDB (via Dexie.js).
3. **PWA Shell Caching:** Service worker caching must reliably serve the static app shell without hydration mismatches or complex server runtime synchronization.
4. **Hosting and Operational Costs:** The deployment target is Cloudflare Pages Free Tier with zero server maintenance overhead.

---

## Decision

We choose **Vite + React + TypeScript** as a pure client-side Single Page Application (SPA). We explicitly reject **Next.js** for this product.

Server-Side Rendering (SSR) and a dedicated Node.js server framework are unnecessary and counterproductive:
- The server has no access to decrypted plaintext and therefore cannot pre-render user content, dashboards, search views, or item details.
- Next.js adds substantial bundle size, complex hydration lifecycles, and coupling to Node/Edge server architectures that complicate pure offline PWA operation.
- Vite provides instantaneous hot module replacement (HMR), lightweight build outputs, standard ES modules, and seamless static deployment to Cloudflare Pages.

---

## Consequences

### Positive
- **Architectural Simplicity:** Clean boundary between client-side state and edge API functions.
- **Zero SSR Overhead:** No hydration mismatches, no dual client/server rendering trees, no server memory consumption for rendering.
- **Pure Static Delivery:** The entire frontend builds into standard static HTML/CSS/JS assets served from Cloudflare's global edge CDN with aggressive caching.
- **Offline & PWA Alignment:** Service worker caching of a versioned static shell is deterministic, reliable, and straightforward.
- **Fast Build Times:** Vite with Rollup/ESBuild provides rapid local development and build pipelines that fit easily within Cloudflare Pages' 500 builds/month free limit.

### Negative / Trade-offs
- **Initial Bundle Load:** All client logic (React, Tailwind, UI primitives, Dexie, MiniSearch, Libsodium WASM) must be downloaded before first paint. This is mitigated by PWA caching after initial install and keeping total uncompressed bundle size modest.
- **No Search Engine Optimization (SEO):** SPAs require client execution to render content. For a private personal vault protected by authentication, SEO is a non-goal (PRD §4).

---

## PRD Citations
- PRD §2.1: *"Frontend: Vite + React + TypeScript. Do not use Next.js for this product: server-side rendering and a separate server framework are not needed for a local-first PWA."*
- PRD §2.8: *"No additional infrastructure: No Next.js, Supabase, Redis, VPS, paid auth provider, or separate backend framework in the MVP."*
- PRD §6: Table of recommended technology stack.
- PRD §18.7: Scope control removing Next.js from MVP.
