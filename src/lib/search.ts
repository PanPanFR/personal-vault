import type { ItemWithId, ItemType } from "./types";

export interface QueryParts {
  type?: ItemType;
  tags: string[];
  isFavorite?: boolean;
  isArchived?: boolean;
  text: string[];
}

export function parseQuery(q: string): QueryParts {
  const parts: QueryParts = { tags: [], text: [] };
  // simple token parser
  const tokens = q.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  for (const tok of tokens) {
    if (tok.startsWith("type:")) parts.type = tok.slice(5) as ItemType;
    else if (tok.startsWith("tag:")) parts.tags.push(tok.slice(4).replace(/^"|"$/g, ""));
    else if (tok.startsWith("is:")) {
      const v = tok.slice(3);
      if (v === "favorite") parts.isFavorite = true;
      if (v === "archived") parts.isArchived = true;
    } else {
      parts.text.push(tok.replace(/^"|"$/g, ""));
    }
  }
  return parts;
}

export function matches(item: ItemWithId, q: string): boolean {
  const parts = parseQuery(q.trim());
  if (parts.type && item.type !== parts.type) return false;
  if (parts.tags.length && !parts.tags.every((t) => item.tags.includes(t))) return false;
  if (parts.isFavorite !== undefined && item.is_favorite !== parts.isFavorite) return false;
  if (parts.isArchived !== undefined && item.is_archived !== parts.isArchived) return false;
  const haystack = [item.title, (item as any).body, (item as any).content, (item as any).url, (item as any).description, (item as any).notes, (item as any).username, item.tags.join(" ")].join(" ").toLowerCase();
  for (const t of parts.text) {
    if (!haystack.includes(t.toLowerCase())) return false;
  }
  return true;
}

export function runSearch(items: ItemWithId[], q: string): ItemWithId[] {
  if (!q.trim()) return [];
  return items.filter((it) => matches(it, q));
}