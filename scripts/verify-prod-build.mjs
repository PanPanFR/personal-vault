#!/usr/bin/env node
/**
 * Production-build release gate — `scripts/verify-prod-build.mjs`
 *
 * Checks that only make sense on the finished build. Fails the release
 * (non-zero exit) on any violation:
 *
 *   1. manifest + icons + sw.js present, manifest actually references the icons
 *   2. dist/sw.js carries the per-build id and an app-shell-only precache list
 *   3. dist/_headers carries a strict CSP (no remote origin, no bare
 *      unsafe-eval) + nosniff + no-referrer + frame denial, and serves
 *      /api/* no-store
 *   4. no remote runtime dependency (CDN script/link/font/img) in the bundle
 *   5. the service worker never intercepts, caches or replays /api/
 *   6. Worker JSON responses are declared no-store in functions/_shared/http.ts
 *
 * Usage: node scripts/verify-prod-build.mjs [distDir]
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, process.argv[2] ?? "dist");

const failures = [];
const notes = [];

function check(condition, message) {
  notes.push(`${condition ? "ok  " : "FAIL"} ${message}`);
  if (!condition) failures.push(message);
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else if (entry.isFile()) out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

const read = (rel) => readFile(join(DIST, rel), "utf8");

async function verifyInstallability(files) {
  check(files.includes("manifest.webmanifest"), "manifest.webmanifest is emitted");
  check(files.includes("index.html"), "index.html is emitted");
  check(
    files.some((f) => f.startsWith("icons/") && f.endsWith(".png")),
    "PNG icons are emitted (192/512/maskable/apple-touch)",
  );

  if (files.includes("manifest.webmanifest")) {
    const manifest = JSON.parse(await read("manifest.webmanifest"));
    const declared = (manifest.icons ?? []).map((icon) => icon.src.replace(/^\//, ""));
    check(
      declared.length > 0 && declared.every((icon) => files.includes(icon)),
      `manifest icons all exist (${declared.length})`,
    );
    check(
      (manifest.icons ?? []).some((icon) => icon.sizes === "192x192") &&
        (manifest.icons ?? []).some((icon) => icon.sizes === "512x512"),
      "manifest declares 192x192 and 512x512 icons",
    );
    check(manifest.display === "standalone", "manifest display=standalone");
    check(Boolean(manifest.start_url), "manifest start_url is set");
  }

  if (files.includes("index.html")) {
    const indexHtml = await read("index.html");
    check(indexHtml.includes('rel="manifest"'), "index.html links the manifest");
    check(indexHtml.includes("apple-touch-icon"), "index.html declares an iOS touch icon");
  }
}

async function verifyServiceWorker(files) {
  check(files.includes("sw.js"), "sw.js is emitted by the build");
  if (!files.includes("sw.js")) return;

  const sw = await read("sw.js");
  const manifest = files.includes("build-manifest.json")
    ? JSON.parse(await read("build-manifest.json"))
    : null;
  const buildId = manifest?.build_id ?? "unknown";

  check(sw.includes(`const BUILD_ID = "${buildId}"`), `sw.js carries build id ${buildId}`);
  check(sw.includes("pv-shell-v"), "sw.js uses the pv-shell-v cache prefix");
  check(
    sw.includes('const NEVER_INTERCEPT_PREFIXES = ["/api/", "/functions/"]'),
    "sw.js refuses to intercept /api/ and /functions/",
  );
  check(sw.includes("PRECACHE_SET.has(url.pathname)"), "sw.js gates asset caching on the allowlist");
  // A dynamic `cache.put(request)` would let any URL be stored.
  check(!/cache\.put\(request\b/.test(sw), "sw.js never puts an opaque request object into Cache");
  check(!/cache\.put\([^)]*\/api\//.test(sw), "sw.js never writes an /api/ URL into Cache");
  check(
    !/fetch\([^)]*\/api\/[^)]*\)/.test(sw),
    "sw.js never fetches an /api/ URL on its own",
  );

  if (manifest) {
    const isAppShell = (url) =>
      url === "/index.html" ||
      url === "/manifest.webmanifest" ||
      url.startsWith("/assets/") ||
      url.startsWith("/icons/");
    check(
      manifest.precache.every(isAppShell),
      "precache manifest contains app-shell URLs only",
    );
    check(
      !manifest.precache.some((url) => url.startsWith("/api/")),
      "precache manifest contains no API URLs",
    );
  }
}

async function verifySecurityHeaders(files) {
  check(files.includes("_headers"), "dist/_headers is emitted");
  if (!files.includes("_headers")) return;

  const raw = await read("_headers");
  // Comment lines are documentation only - Workers ignores them, so parsing must too.
  const headers = raw
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

  check(/Content-Security-Policy:/.test(headers), "_headers sets a Content-Security-Policy");
  check(/default-src 'self'/.test(headers), "CSP default-src is 'self'");
  check(/script-src 'self'/.test(headers), "CSP script-src is 'self'");
  check(/object-src 'none'/.test(headers), "CSP object-src is 'none'");
  check(/frame-ancestors 'none'/.test(headers), "CSP denies framing (frame-ancestors)");
  check(
    !/unsafe-eval(?!')/.test(headers),
    "CSP has no bare unsafe-eval",
  );
  check(
    !/https?:\/\//.test(
      headers.split("\n").filter((l) => l.includes("Content-Security-Policy")).join("\n"),
    ),
    "CSP references no remote origin",
  );
  check(/X-Content-Type-Options:\s*nosniff/.test(headers), "_headers sets nosniff");
  check(/Referrer-Policy:\s*no-referrer/.test(headers), "_headers sets no-referrer");
  check(/X-Frame-Options:\s*DENY/.test(headers), "_headers denies framing");

  const apiBlock = headers.split("/api/*")[1] ?? "";
  check(/Cache-Control:\s*no-store/.test(apiBlock), "/api/* is served no-store");
}

async function verifyNoRemoteRuntime(files) {
  const textAssets = files.filter((f) => /\.(js|css|html|webmanifest)$/.test(f));
  const remoteSrc = /(src|href)\s*=\s*["']https?:\/\//i;
  const remoteImport = /(?:from|import)\s*\(?["']https?:\/\//;

  for (const asset of textAssets) {
    const text = await readFile(join(DIST, asset), "utf8");
    const offenders = [
      remoteSrc.test(text) ? "remote src/href" : null,
      remoteImport.test(text) ? "remote import" : null,
    ].filter(Boolean);
    check(offenders.length === 0, `${asset} has no remote runtime dependency`);
  }
}

async function verifyWorkerApiHeaders() {
  const helperPath = join(ROOT, "functions", "_shared", "http.ts");
  if (!existsSync(helperPath)) {
    check(false, "functions/_shared/http.ts exists");
    return;
  }
  const helper = await readFile(helperPath, "utf8");
  check(/no-store/.test(helper), "Worker JSON helper marks responses no-store");
  check(/nosniff/.test(helper), "Worker JSON helper sets nosniff");
  check(/no-referrer/.test(helper), "Worker JSON helper sets no-referrer");
}

async function verify() {
  if (!existsSync(DIST)) {
    console.error(`dist not found: ${DIST} - run \`pnpm build\` first.`);
    process.exit(1);
  }

  const files = await walk(DIST);
  await verifyInstallability(files);
  await verifyServiceWorker(files);
  await verifySecurityHeaders(files);
  await verifyNoRemoteRuntime(files);
  await verifyWorkerApiHeaders();

  notes.push(`info dist size: ${files.length} files`);
}

verify()
  .then(() => {
    for (const note of notes) console.log(`[verify] ${note}`);
    if (failures.length > 0) {
      console.error(`\n[verify] ${failures.length} production-build check(s) failed.`);
      process.exit(1);
    }
    console.log("\n[verify] production build is release-ready.");
  })
  .catch((err) => {
    console.error(`[verify] crashed: ${err.stack ?? err.message}`);
    process.exit(1);
  });
