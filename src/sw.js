/*
 * Personal Vault service worker — APP-SHELL ONLY (PRD FR-3 G12, pwa-operational §3).
 *
 * TEMPLATE FILE. `scripts/build-pwa.mjs` substitutes:
 *   __BUILD_ID__           -> per-build id (content hash of the emitted build)
 *   __PRECACHE_MANIFEST__  -> JSON array of app-shell paths
 * and writes dist/sw.js. Never hand-edit dist/sw.js.
 *
 * Hard invariants (asserted by tests/pwa/sw.test.ts + scripts/verify-prod-build.mjs):
 *   1. Cache writes happen ONLY for URLs in the precache allowlist.
 *   2. No request under /api/ is ever intercepted, cached or replayed.
 *   3. Non-GET requests are never touched (mutations bypass the SW entirely).
 *   4. Every build owns a private cache name; activate() purges the others.
 */

const BUILD_ID = "__BUILD_ID__";
const CACHE_PREFIX = "pv-shell-v";
const CACHE_NAME = CACHE_PREFIX + BUILD_ID;
const OFFLINE_URL = "/index.html";
const PRECACHE_URLS = __PRECACHE_MANIFEST__;

/** Paths the SW must never intercept (vault API: ciphertext, tokens, pairings). */
const NEVER_INTERCEPT_PREFIXES = ["/api/", "/functions/"];

/** Allowlist index: cache writes are impossible for anything not listed. */
const PRECACHE_SET = new Set(PRECACHE_URLS);

/**
 * Cache keys must be absolute URLs. In a worker the API base URL is the worker
 * script, but being explicit keeps the behaviour identical across browsers and
 * makes the sandboxed tests meaningful.
 */
function absolute(path) {
  return new URL(path, self.location.origin).href;
}

/**
 * Canonical cache key: origin + pathname, query string dropped. Content-hashed
 * build assets never vary by query, and an attacker-supplied `?v=` must not be
 * able to mint unbounded cache entries for an allowlisted path.
 */
function cacheKey(url) {
  return url.origin + url.pathname;
}

function isNavigationRequest(request) {
  if (request.mode === "navigate") return true;
  const accept = request.headers.get("accept") || "";
  return request.destination === "document" && accept.includes("text/html");
}

/** True for same-origin app URLs. Cross-origin requests are never cached. */
function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

/** Vault API + any other server route: hard no-touch. */
function isNeverIntercepted(url) {
  return NEVER_INTERCEPT_PREFIXES.some(
    (prefix) => url.pathname === prefix || url.pathname.startsWith(prefix),
  );
}

/** Stamp the serving shell build so clients can assert they are never stale. */
function stampShell(response, buildId) {
  const headers = new Headers(response.headers);
  headers.set("X-PV-Shell-Build", buildId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(
    PRECACHE_URLS.map(async (path) => {
      const url = absolute(path);
      // `reload` keeps install honest: never pre-cache an HTTP-cached stale asset.
      const request = new Request(url, { cache: "reload", credentials: "same-origin" });
      let response;
      try {
        response = await fetch(request);
      } catch {
        return;
      }
      if (!response || !response.ok) return;
      await cache.put(url, stampShell(response, BUILD_ID));
    }),
  );
}

async function purgeStaleCaches() {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)),
  );
}

async function notifyClients(message) {
  const clientList = await self.clients.matchAll({
    includeUncontrolled: true,
    type: "window",
  });
  for (const client of clientList) {
    client.postMessage({ ...message, buildId: BUILD_ID });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await precacheAppShell();
      // Default activation strategy (plan default): activate immediately, then
      // the client shows the "reloaded" notice. Prompt mode lives in sw-update.ts.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await purgeStaleCaches();
      await self.clients.claim();
      await notifyClients({ type: "ACTIVATED" });
    })(),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") {
    event.waitUntil(
      self.skipWaiting().then(purgeStaleCaches).then(() => self.clients.claim()),
    );
  }
  if (data.type === "GET_VERSION" && event.source) {
    event.source.postMessage({ type: "VERSION", buildId: BUILD_ID, cacheName: CACHE_NAME });
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Invariant 3: mutations and any non-GET never reach the cache layer.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Invariant 2 + cross-origin: vault API and third-party traffic stay untouched.
  if (!isSameOrigin(url) || isNeverIntercepted(url)) return;

  // Offline document fallback. Network-first, so a new deploy is picked up
  // immediately and the cached shell can never lag behind the API.
  if (isNavigationRequest(request)) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          if (fresh && fresh.ok) return stampShell(fresh, BUILD_ID);
          return fresh;
        } catch {
          const cache = await caches.open(CACHE_NAME);
          const shell = await cache.match(absolute(OFFLINE_URL));
          if (shell) return shell;
          return new Response("<!doctype html><title>Offline</title>", {
            status: 503,
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }
      })(),
    );
    return;
  }

  // App-shell assets: cache-first, writes still restricted to the allowlist.
  // The key is the canonical (query-free) URL, so match() and put() can never
  // diverge and no `?v=` variant can grow the cache.
  if (PRECACHE_SET.has(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const key = cacheKey(url);
        const hit = await cache.match(key);
        if (hit) return hit;
        const response = await fetch(request);
        if (response && response.ok && response.type !== "opaque") {
          await cache.put(key, stampShell(response, BUILD_ID));
        }
        return response;
      })(),
    );
    return;
  }

  // Everything else: default network handling, never written to Cache.
});