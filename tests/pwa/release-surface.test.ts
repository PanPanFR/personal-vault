import { describe, expect, test } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Release-surface invariants that must hold on the SOURCE, so they are checked
 * in CI even before a production build exists. scripts/verify-prod-build.mjs
 * repeats every one of them against the real dist output.
 */

const read = (relative: string) =>
  readFileSync(resolve(__dirname, "../..", relative), "utf8");

describe("PWA install surface", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));

  test("manifest is installable: standalone, scoped, start_url, id", () => {
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.name).toBe("Personal Vault");
    expect(manifest.short_name).toBeTruthy();
  });

  test("manifest ships 192/512 PNG icons plus a maskable icon and the SVG", () => {
    const sizes = manifest.icons.map((icon: { sizes: string; type: string; purpose?: string }) => ({
      sizes: icon.sizes,
      type: icon.type,
      purpose: icon.purpose ?? "any",
    }));
    expect(sizes).toContainEqual({ sizes: "192x192", type: "image/png", purpose: "any" });
    expect(sizes).toContainEqual({ sizes: "512x512", type: "image/png", purpose: "any" });
    expect(sizes).toContainEqual({ sizes: "512x512", type: "image/png", purpose: "maskable" });
    expect(sizes).toContainEqual({ sizes: "any", type: "image/svg+xml", purpose: "any" });
  });

  test("every declared icon file exists and is non-empty", () => {
    for (const icon of manifest.icons as Array<{ src: string }>) {
      const path = resolve(__dirname, "../..", "public", icon.src.replace(/^\//, ""));
      expect(existsSync(path), `missing icon ${icon.src}`).toBe(true);
      expect(readFileSync(path).length).toBeGreaterThan(0);
    }
  });

  test("app-shell icons are real PNG / SVG files (magic bytes)", () => {
    const png = readFileSync(resolve(__dirname, "../../public/icons/icon-512.png"));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const svg = read("public/icons/icon.svg");
    expect(svg.startsWith("<svg")).toBe(true);
  });

  test("index.html links the manifest and iOS touch icon, and has no third-party origin", () => {
    const html = read("index.html");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain("apple-touch-icon");
    expect(html).toContain('name="theme-color"');
    expect(html).toContain("viewport-fit=cover");
    expect(html).toMatch(/<noscript>/);
    expect(/(?:src|href)\s*=\s*["']https?:\/\//.test(html)).toBe(false);
  });
});

describe("security headers template", () => {
  // Comment lines document intent; Pages ignores them, so parsing strips them.
  const headers = read("public/_headers")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

  test("pins the CSP placeholder and the wasm build-state note", () => {
    const raw = read("public/_headers");
    expect(raw).toContain("__CSP__");
    expect(raw).toContain("__WASM_HASH_NOTE__");
    expect(headers).toContain("__CSP__");
  });

  test("sets nosniff, no-referrer and frame denial", () => {
    expect(headers).toMatch(/X-Content-Type-Options:\s*nosniff/);
    expect(headers).toMatch(/Referrer-Policy:\s*no-referrer/);
    expect(headers).toMatch(/X-Frame-Options:\s*DENY/);
  });

  test("/api/* is never cacheable by a CDN or the HTTP cache", () => {
    const apiBlock = headers.split("/api/*")[1];
    expect(apiBlock).toMatch(/Cache-Control:\s*no-store/);
    expect(apiBlock).toMatch(/Pragma:\s*no-cache/);
  });

  test("hashed assets are immutable, the document is not", () => {
    const assetsBlock = headers.split("/assets/*")[1].split("/icons/*")[0];
    expect(assetsBlock).toMatch(/immutable/);
    const documentBlock = headers.split("/index.html")[1].split("/*")[0];
    expect(documentBlock).toMatch(/Cache-Control:\s*no-cache/);
  });
});

describe("service worker source invariants", () => {
  const sw = read("src/sw.js");

  test("refuses to intercept the vault API at all", () => {
    expect(sw).toContain('const NEVER_INTERCEPT_PREFIXES = ["/api/", "/functions/"]');
    expect(sw).toMatch(/isNeverIntercepted\(url\)/);
  });

  test("only writes to the cache for allowlisted app-shell paths", () => {
    expect(sw).toContain("const PRECACHE_SET = new Set(PRECACHE_URLS)");
    expect(sw).toMatch(/PRECACHE_SET\.has\(url\.pathname\)/);
    expect(sw).not.toMatch(/cache\.put\([^)]*\/api\//);
  });

  test("skips non-GET requests entirely (mutations bypass the worker)", () => {
    expect(sw).toContain('if (request.method !== "GET") return;');
  });

  test("build id and precache list are injected at build time", () => {
    expect(sw).toContain("__BUILD_ID__");
    expect(sw).toContain("__PRECACHE_MANIFEST__");
  });

  test("auto-activation default plus an explicit SKIP_WAITING path", () => {
    expect(sw).toContain("self.skipWaiting()");
    expect(sw).toContain("self.clients.claim()");
    expect(sw).toContain('data.type === "SKIP_WAITING"');
    expect(sw).toContain("purgeStaleCaches");
  });
});

describe("third-party / remote dependency audit (source level)", () => {
  const files = [
    "src/main.tsx",
    "src/sw-update.ts",
    "src/sync/client.ts",
    "src/sync/triggers.ts",
    "src/pwa/platform.ts",
    "src/pwa/eviction.ts",
    "src/settings/store.ts",
    "src/pages/Settings.tsx",
    "src/components/BackupBanner.tsx",
  ];

  test("no remote script/style/font/image origins in app sources", () => {
    for (const file of files) {
      const contents = read(file);
      const offenders = contents.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+/g) ?? [];
      expect(offenders, `${file} references a remote origin`).toEqual([]);
    }
  });

  test("the API client only ever talks to the configured origin", () => {
    const client = read("src/sync/client.ts");
    const fetches = client.match(/`\$\{this\.apiOrigin\}\$\{path\}`/g) ?? [];
    expect(fetches.length).toBeGreaterThan(0);
    expect(client).not.toMatch(/fetch\(\s*["']https?:\/\//);
  });
});