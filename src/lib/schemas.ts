import { z } from "zod";
import { PLAINTEXT_ITEM_CAP_BYTES } from "./limits";

const ISO_DATE = z.string().min(1);

const tagSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((t) => !/[\x00-\x1f\x7f]/.test(t), "tag contains control character")
  .refine((t) => !t.includes('"'), "tag must not contain double quote");

export const tagsSchema = z.array(tagSchema).max(20);

export const ItemBaseSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    tags: tagsSchema.default([]),
    is_favorite: z.boolean(),
    is_archived: z.boolean(),
    created_at: ISO_DATE,
    updated_at: ISO_DATE,
    schema_version: z.number().int().min(1),
  })
  .passthrough();

export const LinkItemSchema = ItemBaseSchema.extend({
  type: z.literal("link"),
  url: z.string().min(1),
  description: z.string().optional(),
  notes: z.string().optional(),
}).passthrough();

export const NoteItemSchema = ItemBaseSchema.extend({
  type: z.literal("note"),
  body: z.string(),
}).passthrough();

export const SnippetItemSchema = ItemBaseSchema.extend({
  type: z.literal("snippet"),
  content: z.string(),
  language: z.string().optional(),
}).passthrough();

export const CredentialItemSchema = ItemBaseSchema.extend({
  type: z.literal("credential"),
  website: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  notes: z.string().optional(),
}).passthrough();

export const ItemSchema = z.discriminatedUnion("type", [
  LinkItemSchema,
  NoteItemSchema,
  SnippetItemSchema,
  CredentialItemSchema,
]);

export type Item = z.infer<typeof ItemSchema>;
export type LinkItem = z.infer<typeof LinkItemSchema>;
export type NoteItem = z.infer<typeof NoteItemSchema>;
export type SnippetItem = z.infer<typeof SnippetItemSchema>;
export type CredentialItem = z.infer<typeof CredentialItemSchema>;

export function validateTags(tags: unknown): string[] {
  return tagsSchema.parse(tags) as string[];
}

export function serializedJsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export class PlaintextTooLargeError extends Error {
  constructor(size: number) {
    super(`Plaintext item ${size} bytes exceeds cap ${PLAINTEXT_ITEM_CAP_BYTES}`);
    this.name = "PlaintextTooLargeError";
  }
}

export function assertPlaintextSize(value: unknown): void {
  const size = serializedJsonBytes(value);
  if (size > PLAINTEXT_ITEM_CAP_BYTES) throw new PlaintextTooLargeError(size);
}

export const MASTER_ENVELOPE_FIELDS = [
  "crypto_format_version",
  "key_version",
  "kdf_version",
  "argon2_m_kib",
  "argon2_t",
  "argon2_p",
  "salt_b64u",
  "nonce_b64u",
  "wrapped_dek_b64u",
] as const;

export const RECOVERY_ENVELOPE_FIELDS = [
  "crypto_format_version",
  "key_version",
  "nonce_b64u",
  "wrapped_dek_b64u",
] as const;

export const RECOVERY_AUTH_VERIFIER_FIELD = "recovery_auth_verifier";

export const MasterEnvelopeSchema = z
  .object({
    crypto_format_version: z.number().int(),
    key_version: z.number().int(),
    kdf_version: z.number().int(),
    argon2_m_kib: z.number().int(),
    argon2_t: z.number().int(),
    argon2_p: z.number().int(),
    salt_b64u: z.string(),
    nonce_b64u: z.string(),
    wrapped_dek_b64u: z.string(),
  })
  .passthrough();

export const RecoveryEnvelopeSchema = z
  .object({
    crypto_format_version: z.number().int(),
    key_version: z.number().int(),
    nonce_b64u: z.string(),
    wrapped_dek_b64u: z.string(),
  })
  .passthrough();
