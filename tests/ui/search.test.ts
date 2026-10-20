import { describe, it, expect } from "vitest";
import { parseQuery, matches, runSearch } from "../../src/lib/search";
import type { ItemWithId } from "../../src/lib/types";

const now = new Date().toISOString();
const items: ItemWithId[] = [
  {
    id: "1",
    type: "link",
    title: "Vault docs",
    url: "https://example.com/docs",
    tags: ["docs"],
    is_favorite: true,
    is_archived: false,
    created_at: now,
    updated_at: now,
    schema_version: 1,
  },
  {
    id: "2",
    type: "note",
    title: "Shopping list",
    body: "buy milk and bread",
    tags: ["personal"],
    is_favorite: false,
    is_archived: false,
    created_at: now,
    updated_at: now,
    schema_version: 1,
  },
  {
    id: "3",
    type: "snippet",
    title: "Hello",
    content: "console.log('hello')",
    language: "javascript",
    tags: ["docs", "code"],
    is_favorite: false,
    is_archived: true,
    created_at: now,
    updated_at: now,
    schema_version: 1,
  },
];

describe("search query syntax (UI rendering layer)", () => {
  it("parses type: operator", () => {
    expect(parseQuery("type:link").type).toBe("link");
  });

  it("parses tag: operator", () => {
    expect(parseQuery("tag:docs").tags).toEqual(["docs"]);
  });

  it("parses is: operators", () => {
    expect(parseQuery("is:favorite").isFavorite).toBe(true);
    expect(parseQuery("is:archived").isArchived).toBe(true);
  });

  it("parses quoted phrases as one token", () => {
    expect(parseQuery('"shopping list"').text).toEqual(["shopping list"]);
  });

  it("treats an explicit AND as the default (no text term)", () => {
    expect(parseQuery("milk AND bread").text).toEqual(["milk", "bread"]);
  });

  it("keeps an unknown type: value as a text term", () => {
    expect(parseQuery("type:weird").type).toBeUndefined();
    expect(parseQuery("type:weird").text).toEqual(["type:weird"]);
  });

  it("AND semantics: every text token must match", () => {
    expect(matches(items[1], "milk bread")).toBe(true);
    expect(matches(items[1], "milk cheese")).toBe(false);
  });

  it("filters by type + tag + favorite", () => {
    expect(runSearch(items, "type:link").map((i) => i.id)).toEqual(["1"]);
    expect(runSearch(items, "tag:docs").map((i) => i.id).sort()).toEqual([
      "1",
      "3",
    ]);
    expect(runSearch(items, "is:favorite").map((i) => i.id)).toEqual(["1"]);
  });

  it("matches free text across title/body/tags", () => {
    expect(runSearch(items, "milk").map((i) => i.id)).toEqual(["2"]);
  });

  it("returns nothing for blank queries", () => {
    expect(runSearch(items, "   ")).toEqual([]);
  });

  it("matches nothing when the query has no criteria", () => {
    expect(runSearch(items, "AND")).toEqual([]);
    expect(matches(items[1], "AND")).toBe(false);
  });
});
