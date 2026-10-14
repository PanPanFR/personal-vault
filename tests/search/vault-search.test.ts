// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  VaultSearch,
  parseVaultQuery,
  toSearchable,
} from "../../src/search/vault-search";

function sample() {
  return [
    toSearchable("1", {
      type: "note",
      title: "Grocery list",
      body: "buy milk and eggs",
      tags: ["home"],
      is_favorite: true,
      is_archived: false,
      created_at: "2026-10-01T00:00:00.000Z",
      updated_at: "2026-10-02T00:00:00.000Z",
      schema_version: 1,
    }),
    toSearchable("2", {
      type: "link",
      title: "Sodium docs",
      url: "https://doc.libsodium.org",
      description: "crypto reference",
      tags: ["dev", "crypto"],
      is_favorite: false,
      is_archived: false,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-02T00:00:00.000Z",
      schema_version: 1,
    }),
    toSearchable("3", {
      type: "credential",
      title: "Bank login",
      username: "user1",
      tags: ["finance"],
      is_favorite: false,
      is_archived: true,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-05T00:00:00.000Z",
      schema_version: 1,
    }),
  ];
}

describe("vault query parser", () => {
  test("parses operators + quoted phrases", () => {
    const q = parseVaultQuery('type:note tag:home is:favorite "grocery list" milk');
    expect(q.type).toBe("note");
    expect(q.tags).toEqual(["home"]);
    expect(q.isFavorite).toBe(true);
    expect(q.text).toEqual(["grocery list", "milk"]);
  });

  test("created:/updated: filters", () => {
    const q = parseVaultQuery("created:2026-10-01 updated:2026-10-02");
    expect(q.created).toBe("2026-10-01");
    expect(q.updated).toBe("2026-10-02");
  });

  test("unknown operator is an error, not silent text", () => {
    expect(() => parseVaultQuery("foo:bar")).toThrow(/INVALID_QUERY/);
    expect(() => parseVaultQuery("is:unknown")).toThrow(/INVALID_QUERY/);
  });
});

describe("vault search (in-memory, AND semantics)", () => {
  test("build + search + clear on lock", () => {
    const vs = new VaultSearch();
    expect(vs.search("milk")).toEqual([]);
    vs.build(sample());
    expect(vs.size).toBe(3);
    expect(vs.search("milk").map((r) => r.id)).toEqual(["1"]);
    expect(vs.search("type:link crypto").map((r) => r.id)).toEqual(["2"]);
    expect(vs.search("tag:finance").map((r) => r.id)).toEqual(["3"]);
    expect(vs.search("is:archived").map((r) => r.id)).toEqual(["3"]);
    expect(vs.search('"grocery list"').map((r) => r.id)).toEqual(["1"]);
    expect(vs.search("milk crypto")).toEqual([]); // AND semantics
    vs.clear(); // lock purges the index
    expect(vs.size).toBe(0);
    expect(vs.search("milk")).toEqual([]);
  });

  test("invalid operator surfaces as error", () => {
    const vs = new VaultSearch();
    vs.build(sample());
    expect(() => vs.search("bogus:value")).toThrow(/INVALID_QUERY/);
  });
});
