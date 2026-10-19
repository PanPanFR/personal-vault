const UUIDV4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function newRecordId(): string {
  return crypto.randomUUID();
}

export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUIDV4_RE.test(value);
}
export const isRecordId = isUuidV4;
