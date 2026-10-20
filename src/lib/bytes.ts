// UTF-8 payload sizing. One helper so the schema guard, the UI validator and
// the Worker agree on what "256 KiB" means.

export function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

export function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}
