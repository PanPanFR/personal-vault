# 0009. Cloudflare Pages Subdomain First Deployment Strategy

- **Status:** Accepted
- **Date:** 2026-10-13
- **Authoritative Source:** User decisions (2026-10-13); `personal-vault-prd-v3.md` §2 (Decisions 8, 9), §13 (Hosting and free-tier plan), Appendix C (Recovery-kit file)

---

## Context

Personal Vault targets a $0/month operating cost within Cloudflare Free tier quotas (PRD §2.9).

A production web application requires a secure, publicly accessible HTTPS domain to support:
1. **PWA Installation:** Web browsers require a secure origin (HTTPS) to register Service Workers and prompt for PWA installation.
2. **Cryptographic APIs:** Web Crypto and WebAssembly features require a secure context (`isSecureContext === true`).
3. **Recovery Kit Identifier:** The `api_origin` field inside `personal-vault-recovery-kit.json` (PRD Appendix C) must reference an exact, reachable HTTPS origin so an owner can re-locate their cloud vault when all previous devices are lost.

Setting up a custom top-level domain (e.g. `vault.example.com`) incurs domain registration fees (conflicting with the $0/month target) or requires managing DNS zone delegations and domain expiration dates.

---

## Decision

We adopt a **`pages.dev` first** deployment strategy:

1. **Deploy to Default Subdomain:** The production application deploys directly to Cloudflare Pages' managed default subdomain:
   `https://<project-name>.pages.dev`
2. **Predictable Recovery Origin:** The recovery kit file automatically records this origin as `api_origin`:
   `"api_origin": "https://<project-name>.pages.dev"`
3. **Defer Custom Domains:** Custom domain configuration is strictly optional and deferred to post-MVP. Cloudflare Pages natively supports binding custom apex domains or subdomains at any point via dashboard configuration with zero code or schema modifications.

---

## Consequences

### Positive
- **Guaranteed $0/Month Budget:** No domain purchase, renewal, or registrar privacy fees.
- **Instant Automatic TLS:** Cloudflare Pages automatically provisions and renews managed wildcard TLS certificates for `*.pages.dev` with modern cipher suites and HTTP/2/3.
- **Zero DNS Operational Friction:** Eliminates manual CNAME, A-record, or nameserver configuration during setup.
- **Stable Origin for CSP:** Simplifies Content Security Policy (CSP) headers and Service Worker cache scoping.

### Negative / Trade-offs
- **Fixed Subdomain Naming:** The project name chosen in the Cloudflare Pages dashboard dictates the public URL (`https://<project-name>.pages.dev`). Changing the project name alters the URL and would invalidate `api_origin` entries stored in existing recovery kits.
- **Shared Top-Level Domain:** The `.pages.dev` domain is shared with other Cloudflare Pages users, which requires diligent application-level origin isolation (enforced by the vault's single-tenant client-side encryption and strict same-origin API structure).

---

## PRD Citations & User Decisions
- User Decision (2026-10-13): `pages.dev` first; custom domain deferred/optional.
- PRD §2.9: Cost goal targeting $0/month within Cloudflare Free quotas.
- PRD §13.1: *"Start with the provider's `pages.dev` hostname; a custom domain is optional and may cost money."*
- PRD Appendix C: Normative recovery kit file referencing `"api_origin": "https://<pages-project>.pages.dev"`.
