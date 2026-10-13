# 0002. Cloudflare Pages Functions and D1 for Hosting and Storage

- **Status:** Accepted
- **Date:** 2026-10-13
- **Authoritative Source:** `personal-vault-prd-v3.md` §2 (Decisions 2, 3, 8, 9), §6 (Recommended technology stack), §10 (Data model), §13 (Hosting and free-tier plan)

---

## Context

Personal Vault requires an online synchronization backend to coordinate encrypted records, key envelopes, device registrations, and pairing tickets across a user's authorized devices.

Key operational requirements:
1. **Cost Ceiling:** Target $0/month operating cost using free tier quotas (PRD §2.9, §13).
2. **Minimal Operational Burden:** Serverless architecture without operating system patching, container orchestration, or persistent virtual machines (no VPS, Docker, Supabase, Redis).
3. **CORS and Origin Security:** Minimize cross-origin resource sharing (CORS) security risks and preflight latency.
4. **Relational Storage:** The sync model requires structured queries for opaque identifiers, revision tracking, append-only monotonic sequences (`change_seq`), and atomic compare-and-swap (CAS) transactions.

---

## Decision

We deploy the entire backend as **Cloudflare Pages Functions** (executing on the Cloudflare Workers edge runtime) backed by **Cloudflare D1** (serverless relational SQLite) within a single unified Cloudflare Pages project.

- The static SPA and the `/api/v1/*` API endpoints share the exact same origin (`https://<project>.pages.dev` or custom domain).
- Cloudflare D1 binds natively into Pages Functions environment bindings without external database connection pools or credentials.
- All mutating API handlers execute atomic SQL transactions against D1 to enforce compare-and-swap revisions and change sequence assignments.

---

## Consequences

### Positive
- **Same-Origin Simplicity:** Deploying API functions alongside the static frontend eliminates CORS configuration, cross-site cookie/header complications, and separate deployment pipelines.
- **True $0/Month Operational Cost:** Fits comfortably within Cloudflare Free tier quotas:
  - Workers: 100,000 requests/day, 10 ms CPU time per invocation.
  - D1: 5,000,000 rows read/day, 100,000 rows written/day, 500 MB database storage.
  - Pages: 500 builds/month, 25 MiB asset limits.
- **Global Low-Latency Execution:** Pages Functions execute on Cloudflare's edge network close to the client device.
- **Relational Integrity:** D1 provides full SQLite SQL expressiveness, supporting composite indexes for cursor lookups, single-active-ticket partial indexes, and transactional revision checks.

### Negative / Trade-offs
- **Workers 10 ms CPU Limit:** Handlers must remain strictly lightweight. Heavy cryptographic derivations (such as Argon2id KDF and AEAD encryption/decryption) must never run inside Workers; they execute exclusively on client hardware.
- **D1 Free Tier Daily Enforcement:** As of September 1, 2026, Cloudflare enforces hard daily row read and write quotas. Exceeding limits halts sync with `503 QUOTA_EXHAUSTED` until the daily reset. This is mitigated by local-first operation and buffering in the IndexedDB outbox.
- **Per-Invocation Query Budget:** D1 limits each Worker invocation to a maximum of 50 queries. Sync batches must use prepared batch statements or multi-row SQL statements to stay within this limit.

---

## PRD Citations
- PRD §2.2: *"Hosting/API: One Cloudflare Pages project serves the static frontend and same-origin `/api/*` Pages Functions. Pages Functions run on Cloudflare's Workers runtime. This avoids a separate API deployment and minimizes CORS configuration."*
- PRD §2.3: *"Database: Cloudflare D1 stores ciphertext, opaque identifiers, revision/cursor metadata, encrypted key envelopes, and device-authentication metadata only."*
- PRD §2.8: *"No additional infrastructure: No Next.js, Supabase, Redis, VPS, paid auth provider, or separate backend framework in the MVP."*
- PRD §13.1–§13.2: Detailed hosting specifications, free-tier limits, and daily enforcement notes.
