// In-memory MiniSearch over DECRYPTED records only. Built after unlock,
// purged on lock. Never uploads plaintext — search runs locally, queries
// never leave the device.
//
// Query syntax (AND semantics, quoted phrases supported):
//   type:<link|note|snippet|credential>  tag:<tag>  is:<favorite|archived>
//   created:<YYYY-MM-DD>  updated:<YYYY-MM-DD>  "quoted phrase"  free text
// Unknown `prefix:` operators are an ERROR (invalid-operator-as-error rule),
// not silent text — callers surface the message in UI.
import MiniSearch from "minisearch";

export interface SearchableRecord {
  id: string;
  type: string;
  title: string;
  body: string;
  tags: string[];
  is_favorite: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ParsedQuery {
  type?: string;
  tags: string[];
  isFavorite?: boolean;
  isArchived?: boolean;
  created?: string;
  updated?: string;
  text: string[];
}

const KNOWN_OPERATORS = new Set(["type", "tag", "is", "created", "updated"]);

function tokenize(q: string): string[] {
  // Splits on whitespace but keeps quoted phrases intact (quotes stripped).
  const out: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    if (m[1] !== undefined) {
      if (m[1].length > 0) out.push(m[1]);
    } else if (m[2] !== undefined) {
      out.push(m[2]);
    }
  }
  return out;
}

/** Strict parser — throws on unknown `prefix:` operators. */
export function parseVaultQuery(q: string): ParsedQuery {
  const parsed: ParsedQuery = { tags: [], text: [] };
  for (const tok of tokenize(q.trim())) {
    const colon = tok.indexOf(":");
    if (colon > 0) {
      const prefix = tok.slice(0, colon);
      const value = tok.slice(colon + 1);
      if (KNOWN_OPERATORS.has(prefix)) {
        switch (prefix) {
          case "type":
            if (!value) throw new Error("INVALID_QUERY: type: needs a value.");
            parsed.type = value;
            break;
          case "tag":
            if (!value) throw new Error("INVALID_QUERY: tag: needs a value.");
            parsed.tags.push(value);
            break;
          case "is":
            if (value === "favorite") parsed.isFavorite = true;
            else if (value === "archived") parsed.isArchived = true;
            else throw new Error(`INVALID_QUERY: unknown is: value "${value}".`);
            break;
          case "created":
            parsed.created = value;
            break;
          case "updated":
            parsed.updated = value;
            break;
        }
        continue;
      }
      // Unknown prefix — error, never silent text.
      if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(prefix)) {
        throw new Error(`INVALID_QUERY: unknown operator "${prefix}:".`);
      }
      // Contains colon but not an operator shape (e.g. URL, time) → text.
      parsed.text.push(tok);
      continue;
    }
    parsed.text.push(tok);
  }
  return parsed;
}

function recordToDoc(r: SearchableRecord): Record<string, unknown> {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    body: r.body,
    tags: r.tags.join(" "),
    is_favorite: r.is_favorite ? "favorite" : "",
    is_archived: r.is_archived ? "archived" : "",
    created_at: r.created_at.slice(0, 10),
    updated_at: r.updated_at.slice(0, 10),
  };
}

export class VaultSearch {
  private mini: MiniSearch | null = null;
  private docs = new Map<string, SearchableRecord>();

  /** (Re)build the in-memory index from decrypted records. */
  build(records: SearchableRecord[]): void {
    this.clear();
    this.mini = new MiniSearch({
      fields: ["title", "body", "tags", "type"],
      storeFields: ["id"],
      searchOptions: { combineWith: "AND", prefix: true },
    });
    for (const r of records) {
      this.docs.set(r.id, r);
      this.mini.add(recordToDoc(r) as Record<string, string>);
    }
  }

  /** Purge index + docs — called on lock. */
  clear(): void {
    this.mini = null;
    this.docs.clear();
  }

  get size(): number {
    return this.docs.size;
  }

  search(rawQuery: string): SearchableRecord[] {
    const q = rawQuery.trim();
    if (!q || !this.mini) return [];
    const parsed = parseVaultQuery(q); // throws on invalid operator
    let candidates: SearchableRecord[];
    if (parsed.text.length === 0) {
      candidates = [...this.docs.values()];
    } else {
      const andQuery = parsed.text.map((t) => `"${t.replace(/"/g, "")}"`).join(" ");
      const hits = this.mini.search(andQuery, { combineWith: "AND" });
      const ids = new Set(hits.map((h) => String(h.id)));
      candidates = [...this.docs.values()].filter((d) => ids.has(d.id));
      // MiniSearch prefix matching can miss exact-phrase cases on tiny
      // corpora — fall back to substring AND when it returns nothing but
      // the text plainly occurs in the docs.
      if (candidates.length === 0) {
        const hay = (r: SearchableRecord) =>
          `${r.title} ${r.body} ${r.tags.join(" ")}`.toLowerCase();
        const loose = [...this.docs.values()].filter((r) =>
          parsed.text.every((t) => hay(r).includes(t.toLowerCase())),
        );
        if (loose.length > 0) candidates = loose;
      }
    }
    return candidates.filter((r) => {
      if (parsed.type && r.type !== parsed.type) return false;
      if (parsed.tags.length && !parsed.tags.every((t) => r.tags.includes(t))) return false;
      if (parsed.isFavorite !== undefined && r.is_favorite !== parsed.isFavorite) return false;
      if (parsed.isArchived !== undefined && r.is_archived !== parsed.isArchived) return false;
      if (parsed.created && !r.created_at.startsWith(parsed.created)) return false;
      if (parsed.updated && !r.updated_at.startsWith(parsed.updated)) return false;
      return true;
    });
  }
}

/** Flatten a decrypted item payload into a searchable record. */
export function toSearchable(
  recordId: string,
  item: Record<string, unknown>,
): SearchableRecord {
  const tags = Array.isArray(item.tags) ? (item.tags as string[]) : [];
  const textParts = [
    item.title,
    item.body,
    item.content,
    item.url,
    item.description,
    item.notes,
    item.username,
    item.website,
  ].filter((v) => typeof v === "string") as string[];
  return {
    id: recordId,
    type: typeof item.type === "string" ? item.type : "note",
    title: typeof item.title === "string" ? item.title : "",
    body: textParts.join(" "),
    tags,
    is_favorite: item.is_favorite === true,
    is_archived: item.is_archived === true,
    created_at: typeof item.created_at === "string" ? item.created_at : "",
    updated_at: typeof item.updated_at === "string" ? item.updated_at : "",
  };
}
