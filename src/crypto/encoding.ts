// Binary <-> text encodings. All crypto JSON transport uses unpadded URL-safe
// base64 (RFC 4648 §5). Manual Base32 fallback per crypto-spec §6.3.
import { ensureSodium } from "./wasm-guard";

export async function b64uEncode(bytes: Uint8Array): Promise<string> {
  const sodium = await ensureSodium();
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export async function b64uDecode(s: string): Promise<Uint8Array> {
  const sodium = await ensureSodium();
  return sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export function b64uEncodeSync(
  sodium: Awaited<ReturnType<typeof ensureSodium>>,
  bytes: Uint8Array,
): string {
  return sodium.to_base64(bytes, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export function b64uDecodeSync(
  sodium: Awaited<ReturnType<typeof ensureSodium>>,
  s: string,
): Uint8Array {
  return sodium.from_base64(s, sodium.base64_variants.URLSAFE_NO_PADDING);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const sodium = await ensureSodium();
  const digest = sodium.crypto_hash_sha256(bytes);
  return sodium.to_hex(digest).toLowerCase();
}

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const B32_LOOKUP = new Map<string, number>(
  B32_ALPHABET.split("").map((c, i) => [c, i]),
);

/** RFC 4648 Base32, uppercase, no padding. 32 bytes -> 52 chars. */
export function base32EncodeNoPad(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode Base32 (accepts lowercase + hyphen/space grouping, ignores padding). */
export function base32DecodeNoPad(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[\s-]+/g, "").replace(/=+$/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const v = B32_LOOKUP.get(ch);
    if (v === undefined) throw new Error(`Invalid base32 character: ${ch}`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(bytes);
}

/** Grouped display form: 13 groups of 4 separated by hyphens. */
export function base32Grouped(bytes: Uint8Array): string {
  const raw = base32EncodeNoPad(bytes);
  const groups: string[] = [];
  for (let i = 0; i < raw.length; i += 4) groups.push(raw.slice(i, i + 4));
  return groups.join("-");
}

/** Parse grouped or raw Base32 back to bytes. */
export function base32ParseGrouped(input: string): Uint8Array {
  return base32DecodeNoPad(input);
}
