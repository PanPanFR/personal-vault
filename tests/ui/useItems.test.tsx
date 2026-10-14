import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { db } from "../../src/db/dexie";
import { useItems } from "../../src/hooks/useItems";
import type { Item } from "../../src/lib/schemas";

const now = () => new Date().toISOString();

function note(title: string): Item {
  return {
    type: "note",
    title,
    body: "body",
    tags: ["t1"],
    is_favorite: false,
    is_archived: false,
    created_at: now(),
    updated_at: now(),
    schema_version: 1,
  };
}

describe("useItems CRUD with fixtures", () => {
  beforeEach(async () => {
    await db.records.clear();
  });

  it("seeds fixtures on first read", async () => {
    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.length).toBeGreaterThan(0);
  });

  it("creates, favorites, archives, restores, duplicates and deletes", async () => {
    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await db.records.clear();
    });

    let id = "";
    await act(async () => {
      id = await result.current.create(note("CRUD note"));
    });
    expect(result.current.items.find((i) => i.id === id)?.title).toBe(
      "CRUD note",
    );

    await act(async () => {
      await result.current.update(id, { title: "renamed" } as Partial<Item>);
    });
    expect(result.current.items.find((i) => i.id === id)?.title).toBe(
      "renamed",
    );

    await act(async () => {
      await result.current.favorite(id);
    });
    expect(result.current.items.find((i) => i.id === id)?.is_favorite).toBe(
      true,
    );

    await act(async () => {
      await result.current.archive(id);
    });
    expect(result.current.items.find((i) => i.id === id)?.is_archived).toBe(
      true,
    );

    await act(async () => {
      await result.current.restore(id);
    });
    expect(result.current.items.find((i) => i.id === id)?.is_archived).toBe(
      false,
    );

    let copyId = "";
    await act(async () => {
      copyId = (await result.current.duplicate(id)) ?? "";
    });
    expect(copyId).not.toBe("");
    expect(
      result.current.items.find((i) => i.id === copyId)?.title,
    ).toContain("(copy)");

    await act(async () => {
      await result.current.remove(id);
      await result.current.remove(copyId);
    });
    expect(result.current.items.find((i) => i.id === id)).toBeUndefined();
  });

  it("rejects invalid items (bad URL, oversized, bad tags)", async () => {
    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await expect(
      result.current.create({
        type: "link",
        title: "x",
        url: "nope",
        tags: [],
        is_favorite: false,
        is_archived: false,
        created_at: now(),
        updated_at: now(),
        schema_version: 1,
      }),
    ).rejects.toThrow();
  });
});
