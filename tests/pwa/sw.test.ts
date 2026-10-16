import { describe, expect, test, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Service worker lifecycle — plan/pwa-hardening-release.md step 2 + acceptance
 * "Two-build SW update never serves stale shell against new API; old caches purged".
 *
 * The worker is a build-time template, so each spec renders it with a fake build
 * id + precache list and executes it inside a sandbox that emulates the
 * ServiceWorkerGlobalScope (caches, fetch, clients, skipWaiting/claim).
 */

const SW_TEMPLATE = readFileSync(resolve(__dirname, "../../src/sw.js"), "utf8");

interface SandboxOptions {
  buildId: string;
  precache: string[];
  /** Existing cache names (older builds) to prove they get purged. */
  existingCaches?: Record<string, Record<string, string>>;
  network?: Record<string, string>;
  offline?: boolean;
}

interface Sandbox {
  run: (event: "install" | "activate" | "fetch" | "message") => Promise<void>;
  dispatchFetch: (input: string, init?: { method?: string; mode?: string; accept?: string }) => Promise<Response | null>;
  dispatchMessage: (data: unknown) => Promise<void>;
  cacheNames: () => string[];
  cacheEntries: (name: string) => string[];
  cachePaths: (name: string) => string[];
  posted: unknown[];
  skipWaitingCalls: () => number;
  claimCalls: () => number;
  fetchCalls: () => string[];
}

function renderTemplate({ buildId, precache }: Pick<SandboxOptions, "buildId" | "precache">): string {
  return SW_TEMPLATE.replaceAll("__BUILD_ID__", buildId).replaceAll(
    "__PRECACHE_MANIFEST__",
    JSON.stringify(precache),
  );
}

function createSandbox(options: SandboxOptions): Sandbox {
  const { buildId, precache, existingCaches = {}, network = {}, offline = false } = options;
  const cacheStore = new Map<string, Map<string, Response>>();
  for (const [name, entries] of Object.entries(existingCaches)) {
    const map = new Map<string, Response>();
    for (const [url, body] of Object.entries(entries)) {
      map.set(url, new Response(body, { status: 200, headers: { "Content-Type": "text/plain" } }));
    }
    cacheStore.set(name, map);
  }

  const posted: unknown[] = [];
  const fetchCalls: string[] = [];
  let skipWaitingCalls = 0;
  let claimCalls = 0;

  const cachesImpl = {
    async open(name: string) {
      if (!cacheStore.has(name)) cacheStore.set(name, new Map());
      const map = cacheStore.get(name)!;
      const keyOf = (request: Request | string) =>
        typeof request === "string" ? request : request.url;
      return {
        async put(request: Request | string, response: Response) {
          map.set(keyOf(request), response);
        },
        async match(request: Request | string) {
          return map.get(keyOf(request)) ?? undefined;
        },
      };
    },
    async keys() {
      return [...cacheStore.keys()];
    },
    async delete(name: string) {
      return cacheStore.delete(name);
    },
  };

  const fetchImpl = async (input: Request | string) => {
    const url = typeof input === "string" ? input : input.url;
    fetchCalls.push(url);
    if (offline) throw new TypeError("Failed to fetch");
    const path = new URL(url, "https://vault.test").pathname;
    const body = network[path];
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/plain" } });
  };

  const listeners = new Map<string, (event: any) => void>();
  const selfObject = {
    location: { origin: "https://vault.test" },
    clients: {
      async matchAll() {
        return [{ postMessage: (message: unknown) => posted.push(message) }];
      },
      // Real Workers expose Clients.claim(); the sandbox must too.
      async claim() {
        claimCalls += 1;
      },
    },
    skipWaiting: async () => {
      skipWaitingCalls += 1;
    },
    claim: async () => {
      claimCalls += 1;
    },
    addEventListener: (type: string, handler: (event: any) => void) => {
      listeners.set(type, handler);
    },
  };

  const dispatched: Promise<Response>[] = [];
  let waited: Promise<unknown> | null = null;
  const settle = (promise: Promise<unknown> | null): Promise<unknown> =>
    promise ? promise.catch(() => undefined) : Promise.resolve();

  // In a worker context `new Request("/x")` resolves against the script URL;
  // jsdom/undici has no such base, so resolve explicitly here.
  const RequestImpl = class extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === "string" ? new URL(input, "https://vault.test") : input, init);
    }
  };

  // Execute the rendered template with the fake SW global + platform APIs bound.
  const body = renderTemplate({ buildId, precache });
  const factory = new Function(
    "self",
    "caches",
    "fetch",
    "URL",
    "Request",
    "Response",
    "Headers",
    body,
  );
  factory(selfObject, cachesImpl, fetchImpl, URL, RequestImpl, Response, Headers);

  const run = (type: string) => {
    const handler = listeners.get(type);
    if (!handler) return Promise.resolve();
    waited = null;
    handler({
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise;
      },
      respondWith: (promise: Promise<Response>) => {
        dispatched.push(promise);
      },
      request: undefined,
      data: undefined,
      source: { postMessage: (message: unknown) => posted.push(message) },
    });
    return Promise.all([
      settle(waited),
      ...dispatched.map((p) => settle(p)),
    ]).then(() => undefined);
  };

  return {
    async run(event: "install" | "activate" | "fetch" | "message") {
      dispatched.length = 0;
      await run(event);
      await Promise.all(dispatched.map((p) => p.catch(() => undefined)));
    },
    async dispatchFetch(input, init = {}) {
      dispatched.length = 0;
      const handler = listeners.get("fetch");
      if (!handler) return null;
      const request = new Request(new URL(input, "https://vault.test").toString(), {
        method: init.method ?? "GET",
        headers: init.accept ? { accept: init.accept } : undefined,
      });
      Object.defineProperty(request, "mode", { value: init.mode ?? "no-cors" });
      Object.defineProperty(request, "destination", {
        value: init.mode === "navigate" ? "document" : "",
      });
      handler({ request, respondWith: (p: Promise<Response>) => dispatched.push(p), waitUntil: () => undefined });
      if (dispatched.length === 0) return null;
      return dispatched[0];
    },
    async dispatchMessage(data: unknown) {
      dispatched.length = 0;
      waited = null;
      const handler = listeners.get("message");
      if (!handler) return;
      handler({
        data,
        source: { postMessage: (m: unknown) => posted.push(m) },
        waitUntil: (p: Promise<unknown>) => {
          waited = p;
        },
      });
      await Promise.all([
        settle(waited),
        ...dispatched.map((p) => settle(p)),
      ]);
    },
    cacheNames: () => [...cacheStore.keys()],
    cacheEntries: (name: string) => [...(cacheStore.get(name)?.keys() ?? [])],
    cachePaths: (name: string) =>
      [...(cacheStore.get(name)?.keys() ?? [])].map((key) => new URL(key, "https://vault.test").pathname),
    posted,
    skipWaitingCalls: () => skipWaitingCalls,
    claimCalls: () => claimCalls,
    fetchCalls: () => fetchCalls,
  };
}

describe("service worker app-shell caching", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("install precaches exactly the app-shell manifest and claims immediately", async () => {
    const sw = createSandbox({
      buildId: "build1",
      precache: ["/index.html", "/assets/app.js", "/icons/icon-192.png", "/manifest.webmanifest"],
      network: {
        "/index.html": "<html>shell</html>",
        "/assets/app.js": "console.log(1)",
        "/icons/icon-192.png": "png",
        "/manifest.webmanifest": "{}",
      },
    });

    await sw.run("install");

    expect(sw.cacheNames()).toContain("pv-shell-vbuild1");
    expect(sw.cachePaths("pv-shell-vbuild1").sort()).toEqual([
      "/assets/app.js",
      "/icons/icon-192.png",
      "/index.html",
      "/manifest.webmanifest",
    ]);
    // AUTO strategy (plan default): activate without a user prompt.
    expect(sw.skipWaitingCalls()).toBe(1);
  });

  test("never intercepts, caches or replays vault API requests", async () => {
    const sw = createSandbox({
      buildId: "build1",
      precache: ["/index.html", "/assets/app.js"],
      network: { "/index.html": "shell", "/assets/app.js": "js", "/api/v1/sync": '{"ciphertext":"AAA"}' },
    });
    await sw.run("install");
    await sw.run("activate");

    for (const path of ["/api/v1/sync", "/api/v1/vaults/ABC/bootstrap", "/functions/api/v1/sync/batch"]) {
      const response = await sw.dispatchFetch(path, { accept: "application/json" });
      // respondWith not called => the browser performs the real request, untouched.
      expect(response).toBeNull();
      expect(sw.cachePaths("pv-shell-vbuild1")).not.toContain(path);
    }
    expect(sw.fetchCalls().some((url) => url.includes("/api/"))).toBe(false);
  });

  test("never caches non-GET mutations", async () => {
    const sw = createSandbox({
      buildId: "build1",
      precache: ["/index.html"],
      network: { "/index.html": "shell" },
    });
    await sw.run("install");

    const response = await sw.dispatchFetch("/api/v1/sync/batch", { method: "POST" });
    expect(response).toBeNull();
  });

  test("non-allowlisted same-origin GET is served straight from the network", async () => {
    const sw = createSandbox({
      buildId: "build1",
      precache: ["/index.html"],
      network: { "/index.html": "shell", "/telemetry.json": '{"n":1}' },
    });
    await sw.run("install");

    await sw.dispatchFetch("/telemetry.json", { accept: "application/json" });
    expect(sw.cachePaths("pv-shell-vbuild1")).toEqual(["/index.html"]);
  });

  test("navigation falls back to the cached shell when offline", async () => {
    // The shell was precached by an earlier online install; now the network dies.
    const sw = createSandbox({
      buildId: "build1",
      precache: ["/index.html", "/assets/app.js"],
      existingCaches: {
        "pv-shell-vbuild1": {
          "https://vault.test/index.html": "<html>shell</html>",
          "https://vault.test/assets/app.js": "js",
        },
      },
      network: { "/index.html": "<html>shell</html>", "/assets/app.js": "js" },
      offline: true,
    });
    // Install (cache seeded) then activate, mirroring the real install order.
    await sw.run("install");
    await sw.run("activate");

    const response = await sw.dispatchFetch("/", { mode: "navigate", accept: "text/html" });
    expect(response).not.toBeNull();
    expect(await response!.text()).toContain("shell");
  });

  test("precached assets are cache-first and stamped with the serving build", async () => {
    const sw = createSandbox({
      buildId: "build1",
      precache: ["/assets/app.js"],
      network: { "/assets/app.js": "js" },
    });
    await sw.run("install");

    const cached = await sw.dispatchFetch("/assets/app.js");
    expect(cached?.headers.get("X-PV-Shell-Build")).toBe("build1");
  });

  test("query strings cannot mint unbounded cache entries for an allowlisted asset", async () => {
    const sw = createSandbox({
      buildId: "build1",
      precache: ["/assets/app.js"],
      network: { "/assets/app.js": "js" },
    });
    await sw.run("install");
    const before = sw.cacheEntries("pv-shell-vbuild1").length;

    await sw.dispatchFetch("/assets/app.js?v=1");
    await sw.dispatchFetch("/assets/app.js?v=2");

    // The cache still holds exactly the canonical entry for that path.
    expect(sw.cacheEntries("pv-shell-vbuild1").length).toBe(before);
    expect(sw.cachePaths("pv-shell-vbuild1")).toEqual(["/assets/app.js"]);
  });

  test("cross-origin requests are never cached", async () => {
    const sw = createSandbox({ buildId: "build1", precache: ["/index.html"], network: {} });
    await sw.run("install");

    const response = await sw.dispatchFetch("https://cdn.example.com/lib.js");
    expect(response).toBeNull();
  });

  test("GET_VERSION replies with the active build id", async () => {
    const sw = createSandbox({ buildId: "build7", precache: ["/index.html"], network: {} });
    await sw.dispatchMessage({ type: "GET_VERSION" });
    expect(sw.posted).toContainEqual({ type: "VERSION", buildId: "build7", cacheName: "pv-shell-vbuild7" });
  });

  test("SKIP_WAITING message activates and purges (prompt strategy path)", async () => {
    const sw = createSandbox({
      buildId: "build2",
      precache: ["/index.html"],
      existingCaches: { "pv-shell-vbuild1": { "/index.html": "old shell" } },
      network: { "/index.html": "<html>v2</html>" },
    });
    await sw.run("install");
    await sw.dispatchMessage({ type: "SKIP_WAITING" });
    // Once at install (AUTO default), once more from the explicit prompt message.
    expect(sw.skipWaitingCalls()).toBeGreaterThanOrEqual(2);
    expect(sw.cacheNames()).toEqual(["pv-shell-vbuild2"]);
    expect(sw.claimCalls()).toBeGreaterThan(0);
  });
});

describe("two consecutive builds (stale-shell hazard)", () => {
  test("build 2 purges build 1's cache and never mixes shells", async () => {
    // Build 1 installed and serving.
    const build1 = createSandbox({
      buildId: "build1",
      precache: ["/index.html", "/assets/app-v1.js"],
      network: { "/index.html": "<html>v1</html>", "/assets/app-v1.js": "v1" },
    });
    await build1.run("install");
    await build1.run("activate");
    expect(build1.cacheNames()).toEqual(["pv-shell-vbuild1"]);

    // Build 2 lands on the same origin: SW script changed => new worker.
    const build2 = createSandbox({
      buildId: "build2",
      precache: ["/index.html", "/assets/app-v2.js"],
      // Shared storage: the old cache is still there from build 1.
      existingCaches: {
        "pv-shell-vbuild1": {
          "https://vault.test/index.html": "<html>v1</html>",
          "https://vault.test/assets/app-v1.js": "v1",
        },
      },
      network: { "/index.html": "<html>v2</html>", "/assets/app-v2.js": "v2" },
    });

    await build2.run("install");
    await build2.run("activate");

    // Old cache purged, new one private and app-shell only.
    expect(build2.cacheNames()).toEqual(["pv-shell-vbuild2"]);
    expect(build2.cachePaths("pv-shell-vbuild2").sort()).toEqual([
      "/assets/app-v2.js",
      "/index.html",
    ]);
    // Clients are told a new build activated so the tab reloads once.
    expect(build2.posted).toContainEqual({ type: "ACTIVATED", buildId: "build2" });

    // A v1 asset request is not served from the new cache (no stale JS).
    const staleAsset = await build2.dispatchFetch("/assets/app-v1.js");
    expect(staleAsset).toBeNull();
  });
});