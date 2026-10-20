#!/usr/bin/env node
/**
 * Deterministic PWA icon rasteriser — `scripts/gen-icons.mjs`
 *
 * Emits the PNG sizes the manifest and iOS require, with zero dependencies and
 * zero network access, so icon digests are reproducible in CI (they are pinned
 * in dist/build-manifest.json).
 *
 * Output: public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png
 */
import { deflateSync } from "node:zlib";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = join(ROOT, "public", "icons");

const PALETTE = {
  backdrop: [0x28, 0x28, 0x28],
  body: [0x1c, 0x1b, 0x1a],
  edge: [0xdc, 0xdc, 0xdc],
  accent: [0xfa, 0xbd, 0x2f],
  bar: [0x8e, 0xc0, 0x7c],
};

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

/** Minimal RGBA PNG encoder (filter type 0, single IDAT). */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Signed distance helpers, all in 0..1 design space. */
function roundedRect(x, y, halfW, halfH, radius) {
  const dx = Math.abs(x) - (halfW - radius);
  const dy = Math.abs(y) - (halfH - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.min(Math.max(dx, dy), 0) + Math.hypot(ax, ay) - radius;
}

function ring(x, y, radius, thickness) {
  return Math.abs(Math.hypot(x, y) - radius) - thickness / 2;
}

function box(x, y, halfW, halfH) {
  return roundedRect(x, y, halfW, halfH, Math.min(halfW, halfH) * 0.45);
}

function blend(base, layer, alpha) {
  return base.map((c, i) => Math.round(c * (1 - alpha) + layer[i] * alpha));
}

function renderIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  // Maskable icons must survive a circular mask: shrink the glyph into the safe zone.
  const inset = maskable ? 0.3 : 0.14;
  const g = 1 - inset * 2; // glyph scale
  const aa = 1.5 / size;

  // Geometry (design space, y grows downward).
  const bodyCx = 0;
  const bodyCy = 0.2 * g;
  const bodyHalfW = 0.34 * g;
  const bodyHalfH = 0.28 * g;
  const shackleR = 0.2 * g;
  const shackleT = 0.085 * g;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const x = (px + 0.5) / size - 0.5;
      const y = (py + 0.5) / size - 0.5;

      // Backdrop plate (full bleed for maskable, rounded otherwise).
      const plate = maskable ? -1 : roundedRect(x, y, 0.5, 0.5, 0.22);
      let color = PALETTE.backdrop;
      let alpha = maskable ? 1 : clamp01(0.5 - plate / aa);

      // Shackle: upper arc of a ring, sitting on top of the body.
      const shackleBand = ring(x, y, shackleR, shackleT);
      const shackle = y < bodyCy - bodyHalfH + 0.03 * g
        ? clamp01(0.5 - shackleBand / aa)
        : 0;
      color = blend(color, PALETTE.edge, shackle);

      // Body plate with a darker keyhole field.
      const body = box(x - bodyCx, y - bodyCy, bodyHalfW, bodyHalfH);
      const bodyMask = clamp01(0.5 - body / aa);
      color = blend(color, PALETTE.edge, bodyMask);
      color = blend(color, PALETTE.body, bodyMask * 0.92);

      // Keyhole.
      const hole = Math.min(
        Math.hypot(x - bodyCx, y - (bodyCy - 0.07 * g)) - 0.075 * g,
        box(x - bodyCx, y - (bodyCy + 0.08 * g), 0.03 * g, 0.1 * g),
      );
      color = blend(color, PALETTE.accent, bodyMask * clamp01(0.5 - hole / aa));

      const o = (py * size + px) * 4;
      rgba[o] = color[0];
      rgba[o + 1] = color[1];
      rgba[o + 2] = color[2];
      rgba[o + 3] = Math.round(clamp01(alpha) * 255);
    }
  }
  return encodePng(size, size, rgba);
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export const ICON_TARGETS = [
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
  { file: "maskable-512.png", size: 512, maskable: true },
  { file: "apple-touch-icon.png", size: 180 },
];

export async function generateIcons() {
  await mkdir(ICONS, { recursive: true });
  const written = [];
  for (const target of ICON_TARGETS) {
    const png = renderIcon(target.size, { maskable: target.maskable });
    await writeFile(join(ICONS, target.file), png);
    written.push({ file: target.file, bytes: png.length });
  }
  return written;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  generateIcons()
    .then((written) => {
      for (const icon of written) console.log(`[icons] ${icon.file} (${icon.bytes} bytes)`);
    })
    .catch((err) => {
      console.error(`[icons] generation failed: ${err.message}`);
      process.exitCode = 1;
    });
}