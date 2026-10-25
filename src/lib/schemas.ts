import { z } from "zod";
import { PLAINTEXT_ITEM_CAP_BYTES } from "./limits";
import { jsonByteLength } from "./bytes";

// Offset form stays acceptable so a legacy row saved with a ±HH:MM stamp
// can still be re-saved.
const ISO_DATE = z.string().datetime({ offset: true });

const tagSchema = z
  .string()
  .min(1)
  .max(64)
  // eslint-disable-next-line no-control-regex -- control characters are rejected on purpose
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

export class PlaintextTooLargeError extends Error {
  constructor(size: number) {
    super(`Plaintext item ${size} bytes exceeds cap ${PLAINTEXT_ITEM_CAP_BYTES}`);
    this.name = "PlaintextTooLargeError";
  }
}

export function assertPlaintextSize(value: unknown): void {
  const size = jsonByteLength(value);
  if (size > PLAINTEXT_ITEM_CAP_BYTES) throw new PlaintextTooLargeError(size);
}

