export function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(s);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function base64UrlDecode(s: string): Uint8Array {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) {
    b64 += "=";
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  const buf = await crypto.subtle.digest("SHA-256", data as any);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Bytes(input: Uint8Array): Promise<Uint8Array> {
  const buf = await crypto.subtle.digest("SHA-256", input as any);
  return new Uint8Array(buf);
}

export function randomTokenBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function verifyEd25519(
  publicKeyB64u: string,
  message: Uint8Array,
  signatureB64u: string,
): Promise<boolean> {
  try {
    const rawKey = base64UrlDecode(publicKeyB64u);
    const rawSig = base64UrlDecode(signatureB64u);
    if (rawKey.length !== 32 || rawSig.length !== 64) {
      return false;
    }
    const key = await crypto.subtle.importKey(
      "raw",
      rawKey as any,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify("Ed25519", key, rawSig as any, message as any);
  } catch {
    return false;
  }
}

export function isSha256Hex(s: unknown): s is string {
  return typeof s === "string" && /^[0-9a-f]{64}$/.test(s);
}

export function isUuidV4(s: unknown): s is string {
  return (
    typeof s === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      s,
    )
  );
}

export function isVaultId(s: unknown): s is string {
  return typeof s === "string" && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(s);
}
