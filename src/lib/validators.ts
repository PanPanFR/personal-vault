// UI-friendly validation helpers. Caps mirror the frozen foundations
// contract (src/lib/limits.ts + src/lib/schemas.ts) — do not change values
// here; change them in limits.ts under a contract rev.
import {
  TAG_MAX_PER_ITEM,
  TAG_MAX_LENGTH,
  PLAINTEXT_ITEM_CAP_BYTES,
} from "./limits";
import { newRecordId } from "./ids";

export { TAG_MAX_PER_ITEM, TAG_MAX_LENGTH, PLAINTEXT_ITEM_CAP_BYTES };

export function validateTag(tag: string): string | null {
  if (!tag || tag.trim().length === 0) return "Tag cannot be empty";
  if (tag.length > TAG_MAX_LENGTH)
    return `Tag exceeds ${TAG_MAX_LENGTH} characters`;
  if (tag.includes('"')) return 'Tag cannot contain "';
  // eslint-disable-next-line no-control-regex -- must match schemas.ts tagSchema
  if (/[\x00-\x1f\x7f]/.test(tag))
    return "Tag cannot contain control characters";
  return null;
}

export function validateTags(tags: string[]): string | null {
  if (tags.length > TAG_MAX_PER_ITEM)
    return `Max ${TAG_MAX_PER_ITEM} tags per item`;
  for (const t of tags) {
    const err = validateTag(t);
    if (err) return err;
  }
  if (new Set(tags).size !== tags.length) return "Duplicate tags";
  return null;
}

export function validateUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function sizeGuard(payload: unknown): boolean {
  const json = JSON.stringify(payload);
  return new TextEncoder().encode(json).length <= PLAINTEXT_ITEM_CAP_BYTES;
}

/** UI fixture IDs are record UUIDs (foundations ids.ts is source of truth). */
export function newId(): string {
  try {
    return newRecordId();
  } catch {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}
