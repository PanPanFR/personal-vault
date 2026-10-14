// 256-bit vault Data Encryption Key — CSPRNG master root, memory-only.
import { ensureSodium } from "./wasm-guard";

export const DEK_BYTES = 32;

export async function generateDEK(): Promise<Uint8Array> {
  const sodium = await ensureSodium();
  const dek = sodium.randombytes_buf(DEK_BYTES);
  return new Uint8Array(dek);
}

export function wipeKey(key: Uint8Array | null | undefined): void {
  if (!key) return;
  try {
    key.fill(0);
  } catch {
    for (let i = 0; i < key.length; i++) key[i] = 0;
  }
}
