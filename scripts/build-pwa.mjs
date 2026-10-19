#!/usr/bin/env node
/**
 * Personal Vault PWA build step — `scripts/build-pwa.mjs`
 *
 * Runs after `vite build` and materialises everything derived from the
 * finished build:
 *
 *   1. dist/sw.js        per-build cache name + precache manifest from src/sw.js
 *   2. dist/_headers     Pages headers with the injected CSP
 *   3. dist/build-manifest.json  pinned digests of every shipped file
 *
 * Deterministic: same inputs -> same build id. No network access.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

/** Files that must never be precached even if they look like app-shell. */
const NEVER_PRECACHE = [/^\/api\//, /^\/functions\//, /^\/_headers$/, /sw\.js$/];

function toPosix(p) {
  return p.split(sep).join(posix.sep);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walk(full, base)));
    } else if (entry.isFile()) {
      out.push(toPosix(relative(base, full)).replace(/\\/g, "/"));
    }
  }
  return out;
}

function isPrecacheable(urlPath) {
  if (NEVER_PRECACHE.some((re) => re.test(urlPath))) return false;
  // Only the document shell, hashed build assets, icons and the manifest.
  return (
    urlPath === "/index.html" ||
    urlPath === "/manifest.webmanifest" ||
    urlPath.startsWith("/assets/") ||
    urlPath.startsWith("/icons/")
  );
}

async function readTemplate(relativePath) {
  return readFile(join(ROOT, relativePath), "utf8");
}

/** Content-addressed build id: hash of every precached file digest + file list. */
function computeBuildId(digests, precache) {
  const fingerprint = precache.map((url) => `${url}:${digests[url] ?? "missing"}`).join("\n");
  return sha256(Buffer.from(fingerprint, "utf8")).slice(0, 12);
}

async function renderServiceWorker(buildId, precache) {
  const template = await readTemplate("src/sw.js");
  return template
    .replaceAll("__BUILD_ID__", buildId)
    .replaceAll("__PRECACHE_MANIFEST__", JSON.stringify(precache, null, 2));
}

/**
 * CSP. `style-src` keeps 'unsafe-inline' only because the search overlay sets
 * inline style attributes on operator chips (CSP has no attribute-scoped
 * alternative short of hashing each value).
 */
function buildCsp() {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

async function renderHeaders() {
  const template = await readTemplate("public/_headers");
  return template.replaceAll("__CSP__", buildCsp());
}

export async function buildPwa() {
  if (!existsSync(DIST)) {
    throw new Error("dist/ not found — run `vite build` before build-pwa.");
  }

  const files = (await walk(DIST)).sort();
  const digests = {};
  for (const file of files) {
    digests[`/${file}`] = sha256(await readFile(join(DIST, file)));
  }

  const precache = files.map((f) => `/${f}`).filter(isPrecacheable).sort();
  const buildId = computeBuildId(digests, precache);

  await mkdir(DIST, { recursive: true });
  await writeFile(join(DIST, "sw.js"), await renderServiceWorker(buildId, precache), "utf8");
  await writeFile(join(DIST, "_headers"), await renderHeaders(), "utf8");
  await writeFile(
    join(DIST, "build-manifest.json"),
    `${JSON.stringify({ build_id: buildId, cache_name: `pv-shell-v${buildId}`, precache, files: digests }, null, 2)}\n`,
    "utf8",
  );

  // The SW itself must never be cached by an older worker or by the HTTP cache.
  const stats = await stat(join(DIST, "sw.js"));
  return { buildId, precache, swBytes: stats.size };
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  buildPwa()
    .then(({ buildId, precache }) => {
      console.log(`[pwa] build id   : ${buildId}`);
      console.log(`[pwa] cache name : pv-shell-v${buildId}`);
      console.log(`[pwa] precached  : ${precache.length} app-shell files`);
    })
    .catch((err) => {
      console.error(`[pwa] build failed: ${err.message}`);
      process.exitCode = 1;
    });
}
