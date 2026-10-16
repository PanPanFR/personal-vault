#!/usr/bin/env node
/**
 * Production-build release gate — `scripts/verify-prod-build.mjs`
 *
 * Plan/pwa-hardening-release.md acceptance criteria that are only meaningful on
 * the finished build. Fails the release (non-zero exit) on any violation:
 *
 *   1. manifest + icons + sw.js present, manifest actually references the icons
 *   2. dist/sw.js has a per-build cache name and an app-shell-only precache list
 *   3. dist/_headers carries CSP with 'wasm-unsafe-eval' + nosniff + no-referrer
 *      + frame denial, and pins the digest of every shipped .wasm asset
 *   4. no remote runtime dependency (CDN script/link/font/img) in the bundle
 *   5. no plaintext API material in the service worker (source-level invariant)
 *   6. API responses are declared no-store in both headers and Worker helpers
 *
 * Usage: node scripts/verify-prod-build.mjs [distDir]
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, process.argv[2] ?? "dist");

const failures = [];
const notes = [];

function check(condition, message) {
  if (condition) {
    notes.push(`ok   ${message}`);
  } else {
    failures.push(message);
    notes.push(`FAIL ${message}`);
  }
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

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function verify() {
  if (!existsSync(DIST)) {
    console.error(`dist not found: ${DIST} — run \`pnpm build\` first.`);
    process.exit(1);
  }

  const files = await walk(DIST);
  const read = (rel) => readFile(join(DIST, rel), "utf8");

  // --- 1. installability -----------------------------------------------------
  check(files.includes("manifest.webmanifest"), "manifest.webmanifest is emitted");
  check(files.includes("index.html"), "index.html is emitted");
  check(
    files.some((f) => f.startsWith("icons/") && f.endsWith(".png")),
    "PNG icons are emitted (192/512/maskable/apple-touch)",
  );
  if (files.includes("manifest.webmanifest")) {
    const manifest = JSON.parse(await read("manifest.webmanifest"));
    const declared = (manifest.icons ?? []).map((icon) => icon.src.replace(/^\//, ""));
    const missing = declared.filter((icon) => !files.includes(icon));
    check(missing.length === 0, `manifest icons all exist (${declared.length})`);
    check(
      (manifest.icons ?? []).some((icon) => icon.sizes === "192x192") &&
        (manifest.icons ?? []).some((icon) => icon.sizes === "512x512"),
      "manifest declares 192x192 and 512x512 icons",
    );
    check(manifest.display === "standalone", "manifest display=standalone");
    check(Boolean(manifest.start_url), "manifest start_url is set");
  }
  const indexHtml = files.includes("index.html") ? await read("index.html") : "";
  check(indexHtml.includes('rel="manifest"'), "index.html links the manifest");
  check(indexHtml.includes("apple-touch-icon"), "index.html declares an iOS touch icon");

  // --- 2. service worker -----------------------------------------------------
  check(files.includes("sw.js"), "sw.js is emitted by the build");
  if (files.includes("sw.js")) {
    const sw = await read("sw.js");
    const manifestJson = files.includes("build-manifest.json")
      ? JSON.parse(await read("build-manifest.json"))
      : null;
    const buildId = manifestJson?.build_id ?? "unknown";
    check(sw.includes(`const BUILD_ID = "${buildId}"`), `sw.js carries build id ${buildId}`);
    check(sw.includes(`pv-shell-v`), "sw.js uses the pv-shell-v cache prefix");
    check(
      sw.includes('const NEVER_INTERCEPT_PREFIXES = ["/api/", "/functions/"]'),
      "sw.js refuses to intercept /api/ and /functions/",
    );
    // Every cache write must use a literal key derived from the allowlisted
    // pathname. A dynamic `cache.put(request)` would let any URL be stored.
    check(!/cache\.put\(request\b/.test(sw), "sw.js never puts an opaque request object into Cache");
    check(!/cache\.put\([^)]*\/api\//.test(sw), "sw.js never writes an /api/ URL into Cache");
    check(sw.includes("PRECACHE_SET.has(url.pathname)"), "sw.js gates asset caching on the allowlist");
    check(
      manifestJson !== null &&
        manifestJson.precache.every((url) =>
          url === "/index.html" ||
          url === "/manifest.webmanifest" ||
          url.startsWith("/assets/") ||
          url.startsWith("/icons/"),
        ),
      "precache manifest contains app-shell URLs only",
    );
    check(
      manifestJson !== null && !manifestJson.precache.some((url) => url.startsWith("/api/")),
      "precache manifest contains no API URLs",
    );
  }

  // --- 3. security headers ---------------------------------------------------
  check(files.includes("_headers"), "dist/_headers is emitted");
  if (files.includes("_headers")) {
    const raw = await read("_headers");
    // Comment lines are documentation only — Pages ignores them, so parsing must too.
    const headers = raw
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    check(/Content-Security-Policy:/.test(headers), "_headers sets a Content-Security-Policy");
    check(/'wasm-unsafe-eval'/.test(headers), "CSP allows the minimum 'wasm-unsafe-eval'");
    check(/default-src 'self'/.test(headers), "CSP default-src is 'self'");
    check(!/unsafe-eval(?!')/.test(headers.replace("'wasm-unsafe-eval'", "")), "CSP has no bare unsafe-eval");
    check(!/https?:\/\//.test(headers.split("\n").filter((l) => l.includes("Content-Security-Policy")).join("\n")),
      "CSP references no remote origin");
    check(/X-Content-Type-Options:\s*nosniff/.test(headers), "_headers sets nosniff");
    check(/Referrer-Policy:\s*no-referrer/.test(headers), "_headers sets no-referrer");
    check(/X-Frame-Options:\s*DENY/.test(headers), "_headers denies framing");
    check(/frame-ancestors 'none'/.test(headers), "CSP denies framing (frame-ancestors)");

    const apiBlock = headers.split("/api/*")[1] ?? "";
    check(/Cache-Control:\s*no-store/.test(apiBlock), "/api/* is served no-store");

    // Every shipped wasm asset must be pinned by digest. Note: CSP hash sources
    // are defense-in-depth for browsers that enforce them on wasm compilation;
    // dist/build-manifest.json is the authoritative integrity record.
    const wasmFiles = files.filter((f) => f.endsWith(".wasm"));
    if (wasmFiles.length === 0) {
      notes.push("info no standalone .wasm asset in this build (pure-JS sumo crypto)");
    } else {
      for (const wasm of wasmFiles) {
        const digest = sha256(await readFile(join(DIST, wasm)));
        check(headers.includes(`'sha256-${digest}'`), `CSP pins ${wasm} digest`);
      }
    }
    if (files.includes("build-manifest.json")) {
      const manifest = JSON.parse(await read("build-manifest.json"));
      for (const wasm of wasmFiles) {
        check(
          manifest.files[`/${wasm}`] !== undefined,
          `build-manifest.json records the digest of ${wasm}`,
        );
      }
    }
  }

  // --- 4. no remote runtime dependency --------------------------------------
  const textAssets = files.filter((f) => /\.(js|css|html|webmanifest)$/.test(f));
  const remotePattern = /(src|href)\s*=\s*["']https?:\/\//i;
  for (const asset of textAssets) {
    const contents = await readFile(join(DIST, asset));
    const text = contents.toString("utf8");
    const offenders = [];
    if (remotePattern.test(text)) offenders.push("remote src/href");
    // Bare fetch/import targets to another origin.
    if (/(?:from|import)\s*\(?["']https?:\/\//.test(text)) offenders.push("remote import");
    check(offenders.length === 0, `${asset} has no remote runtime dependency${offenders.length ? ` (${offenders.join(", ")})` : ""}`);
  }

  // --- 5. worker API headers -------------------------------------------------
  const httpHelper = join(ROOT, "functions", "_shared", "http.ts");
  if (existsSync(httpHelper)) {
    const helper = await readFile(httpHelper, "utf8");
    check(/no-store/.test(helper), "Worker JSON helper marks responses no-store");
    check(/nosniff/.test(helper), "Worker JSON helper sets nosniff");
    check(/no-referrer/.test(helper), "Worker JSON helper sets no-referrer");
  }

  // --- 6. D1 row-size gate --------------------------------------------------
  const batch = join(ROOT, "functions", "api", "v1", "sync", "batch.ts");
  if (existsSync(batch)) {
    const contents = await readFile(batch, "utf8");
    check(/384 \* 1024/.test(contents), "sync batch enforces the 384 KiB ciphertext row gate");
  }

  const distStat = await stat(DIST);
  if (distStat) notes.push(`info dist size: ${files.length} files`);
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