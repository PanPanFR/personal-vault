import { ulid as generateUlid } from "ulid";

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const UUIDV4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function newVaultId(): string { return generateUlid(); }
export function newRecordId(): string { return crypto.randomUUID(); }
export function newDeviceId(): string { return crypto.randomUUID(); }
export function newMutationId(): string { return crypto.randomUUID(); }
export function newTicketId(): string { return crypto.randomUUID(); }

export function isVaultId(value: unknown): value is string {
  return typeof value === "string" && ULID_RE.test(value);
}
export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUIDV4_RE.test(value);
}
export const isRecordId = isUuidV4;
export const isDeviceId = isUuidV4;
export const isMutationId = isUuidV4;
export const isTicketId = isUuidV4;
