import type { ItemWithId, ItemType } from "./types";

export interface QueryParts {
  type?: ItemType;
  tags: string[];
  isFavorite?: boolean;
  isArchived?: boolean;
  text: string[];
}

const ITEM_TYPES: ItemType[] = ["link", "note", "snippet", "credential"];

function unquote(token: string): string {
  return token.replace(/^"|"$/g, "");
}

/**
 * Query syntax: `type:`, `tag:`, `is:favorite|archived`, quoted phrases and
 * free text. Every token must match (AND). An explicit `AND` is accepted as a
 * readability helper - it is the default behaviour.
 */
export function parseQuery(q: string): QueryParts {
  const parts: QueryParts = { tags: [], text: [] };
  const tokens = q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];

  for (const token of tokens) {
    if (token.toUpperCase() === "AND" && !token.startsWith('"')) continue;

    if (token.startsWith("type:")) {
      const value = unquote(token.slice(5));
      if (ITEM_TYPES.includes(value as ItemType)) parts.type = value as ItemType;
      else parts.text.push(token);
      continue;
    }

    if (token.startsWith("tag:")) {
      parts.tags.push(unquote(token.slice(4)));
      continue;
    }

    if (token.startsWith("is:")) {
      const value = unquote(token.slice(3));
      if (value === "favorite") parts.isFavorite = true;
      else if (value === "archived") parts.isArchived = true;
      else parts.text.push(token);
      continue;
    }

    parts.text.push(unquote(token));
  }

  return parts;
}

/**
 * Every field a free-text search may match. The credential password is
 * deliberately excluded: searching must never surface a secret.
 */
function searchableText(item: ItemWithId): string {
  const fields: string[] = [item.title, ...item.tags];
  switch (item.type) {
    case "link":
      fields.push(item.url, item.description ?? "", item.notes ?? "");
      break;
    case "note":
      fields.push(item.body);
      break;
    case "snippet":
      fields.push(item.content, item.language ?? "");
      break;
    case "credential":
      fields.push(item.website ?? "", item.username ?? "", item.notes ?? "");
      break;
  }
  return fields.join(" ").toLowerCase();
}

/** A query without a single criterion (e.g. just "AND") matches nothing. */
function hasCriteria(parts: QueryParts): boolean {
  return (
    parts.type !== undefined ||
    parts.tags.length > 0 ||
    parts.isFavorite !== undefined ||
    parts.isArchived !== undefined ||
    parts.text.length > 0
  );
}

export function matches(item: ItemWithId, q: string): boolean {
  const parts = parseQuery(q.trim());
  if (!hasCriteria(parts)) return false;
  if (parts.type && item.type !== parts.type) return false;
  if (parts.tags.length && !parts.tags.every((tag) => item.tags.includes(tag))) return false;
  if (parts.isFavorite !== undefined && item.is_favorite !== parts.isFavorite) return false;
  if (parts.isArchived !== undefined && item.is_archived !== parts.isArchived) return false;

  const haystack = searchableText(item);
  return parts.text.every((term) => haystack.includes(term.toLowerCase()));
}

export function runSearch(items: ItemWithId[], q: string): ItemWithId[] {
  if (!q.trim()) return [];
  return items.filter((item) => matches(item, q));
}
