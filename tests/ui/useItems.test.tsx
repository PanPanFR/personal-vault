import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
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

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** Server-side store the fetch mock reads/writes. */
let serverStore: Map<string, any>;

beforeEach(() => {
  serverStore = new Map();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/api/session")) return jsonResponse({ authenticated: true });
      if (url.match(/\/api\/items$/) && method === "GET") {
        return jsonResponse({ items: [...serverStore.values()] });
      }
      const itemMatch = url.match(/\/api\/items\/([^/]+)$/);
      if (itemMatch) {
        const id = decodeURIComponent(itemMatch[1]);
        if (method === "PUT") {
          serverStore.set(id, JSON.parse(init?.body as string));
          return jsonResponse({ ok: true });
        }
        if (method === "DELETE") {
          serverStore.delete(id);
          return jsonResponse({ ok: true });
        }
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useItems against the items API", () => {
  it("loads the server list", async () => {
    serverStore.set("seed-1", { id: "seed-1", ...note("Seeded") });
    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map((i) => i.title)).toEqual(["Seeded"]);
  });

  it("creates, updates, favorites, archives, restores, duplicates and deletes", async () => {
    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let id = "";
    await act(async () => {
      id = await result.current.create(note("CRUD note"));
    });
    expect(result.current.items.find((i) => i.id === id)?.title).toBe("CRUD note");
    expect(serverStore.has(id)).toBe(true);

    await act(async () => {
      await result.current.update(id, { title: "renamed" } as Partial<Item>);
    });
    expect(result.current.items.find((i) => i.id === id)?.title).toBe("renamed");

    await act(async () => {
      await result.current.favorite(id);
    });
    expect(result.current.items.find((i) => i.id === id)?.is_favorite).toBe(true);

    await act(async () => {
      await result.current.archive(id);
    });
    expect(result.current.items.find((i) => i.id === id)?.is_archived).toBe(true);

    await act(async () => {
      await result.current.restore(id);
    });
    expect(result.current.items.find((i) => i.id === id)?.is_archived).toBe(false);

    let copyId = "";
    await act(async () => {
      copyId = (await result.current.duplicate(id)) ?? "";
    });
    expect(copyId).not.toBe("");
    expect(result.current.items.find((i) => i.id === copyId)?.title).toContain("(copy)");

    await act(async () => {
      await result.current.remove(id);
      await result.current.remove(copyId);
    });
    expect(result.current.items.find((i) => i.id === id)).toBeUndefined();
    expect(serverStore.size).toBe(0);
  });

  it("rejects invalid items before any request (bad URL, bad tags)", async () => {
    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.loading).toBe(false));
    const calls = (globalThis.fetch as any).mock.calls.length;
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
    expect((globalThis.fetch as any).mock.calls.length).toBe(calls);
  });

  it("refetches on window focus so another device's writes appear", async () => {
    const { result } = renderHook(() => useItems());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toHaveLength(0);

    // Another device writes; this tab refocuses.
    serverStore.set("remote-1", { id: "remote-1", ...note("From phone") });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await waitFor(() =>
      expect(result.current.items.map((i) => i.title)).toEqual(["From phone"]),
    );
  });
});
