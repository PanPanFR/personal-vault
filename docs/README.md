# Personal Vault Documentation

Technical documentation for Personal Vault: how the system is built, how the
API behaves, what the security model is and how to operate it. Seven documents
plus this index.

## Precedence

When two documents disagree, resolve it in this order:

1. The implementation and its tests, the code is what runs
2. [`api-spec.md`](api-spec.md), the wire contract
3. [`data-model.md`](data-model.md) and [`security-threat-model.md`](security-threat-model.md)
4. [`architecture.md`](architecture.md), [`ui-ux.md`](ui-ux.md), [`pwa-operational.md`](pwa-operational.md)
5. [`decisions.md`](decisions.md), the reasoning behind the current shape

There is no product requirements document and no machine readable API schema.
The API contract is `api-spec.md` and nothing else.

## Where to read what

| If you need to understand | Read |
|---|---|
| The runtime topology, the request flow, the deploy model, the operations runbook | [`architecture.md`](architecture.md) |
| The six API routes, the payloads, the error codes, the limits | [`api-spec.md`](api-spec.md) |
| The D1 tables, the item contract, the size caps, the identifiers | [`data-model.md`](data-model.md) |
| What the system protects, what it does not, the headers, the CSP, incident guidance | [`security-threat-model.md`](security-threat-model.md) |
| The routes, the forms, the search syntax, the i18n, the theming, accessibility | [`ui-ux.md`](ui-ux.md) |
| The service worker, the build pipeline, the install surface, deploy and rollback | [`pwa-operational.md`](pwa-operational.md) |
| Why the system looks like this, and what was removed | [`decisions.md`](decisions.md) |

## The catalog

- [`architecture.md`](architecture.md): the Worker, the static assets, D1, the
  auth flow, the data flow, the build and deploy pipeline, the runbook and the
  deliberate non-goals.
- [`api-spec.md`](api-spec.md): the six routes with request and response
  shapes, the error code catalogue, the rate limit and the size caps.
- [`data-model.md`](data-model.md): the `items` and `sessions` tables, the
  zod item contract, the tag rules, the caps, the identifiers and the client
  side storage.
- [`security-threat-model.md`](security-threat-model.md): the plaintext
  reality, the trust boundaries, the protections, the gaps, the CSP and what
  to do when something leaks.
- [`ui-ux.md`](ui-ux.md): the information architecture, the item form, the
  lifecycle actions, the search syntax, the locale system, the design tokens
  and the accessibility baseline.
- [`pwa-operational.md`](pwa-operational.md): the build artefacts, the service
  worker rules, the update lifecycle, the install path, the headers, the
  deploy and rollback runbook and the troubleshooting table.
- [`decisions.md`](decisions.md): nine decisions that are still in force, plus
  the table of superseded ones.

## Conventions

- English, plain and declarative.
- Structural claims cite the source path, for example
  `functions/api/items/[id].ts`.
- Tables where a table fits.
- The app stores plaintext. Security documents say so in the first paragraph
  rather than burying it.

## Kept in step with the code

These documents describe the code as it stands. When the code and a document
disagree, the document is wrong and gets fixed. Two known drifts are recorded
in [`data-model.md`](data-model.md) (the stale ULID comment in the migration)
and in [`pwa-operational.md`](pwa-operational.md) (the manifest description and
the deleted build verification script).
