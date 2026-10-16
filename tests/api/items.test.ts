// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { resetRateLimiter } from "../../functions/api/login";

function note(id: string, title: string, updatedAt: string) {
  return {
    id,
    type: "note",
    title,
    body: "hello",
    tags: ["t"],
    is_favorite: false,
    is_archived: false,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: updatedAt,
    schema_version: 1,
  };
}

function put(server: TestServer, cookie: string, item: unknown) {
  return server.fetch(`/api/items/${(item as any).id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(item),
  });
}

describe("items API: list / upsert / delete", () => {
  let server: TestServer;
  let cookie: string;

  beforeEach(async () => {
    resetRateLimiter();
    server = new TestServer();
    cookie = await server.login();
  });

  afterEach(() => {
    server.close();
  });

  it("rejects unauthenticated access to every items route", async () => {
    const list = await server.fetch("/api/items");
    expect(list.status).toBe(401);
    const upsert = await server.fetch("/api/items/abc", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(note("abc", "x", "2026-01-01T00:00:00.000Z")),
    });
    expect(upsert.status).toBe(401);
    const del = await server.fetch("/api/items/abc", { method: "DELETE" });
    expect(del.status).toBe(401);
  });

  it("roundtrips an item: put → list", async () => {
    const res = await put(server, cookie, note("id1", "First", "2026-01-01T10:00:00.000Z"));
    expect(res.status).toBe(200);

    const list = await server.fetch("/api/items", { headers: { Cookie: cookie } });
    const { items } = await list.json();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("id1");
    expect(items[0].title).toBe("First");
  });

  it("upsert overwrites an existing id (last write wins)", async () => {
    await put(server, cookie, note("id1", "Old", "2026-01-01T10:00:00.000Z"));
    await put(server, cookie, note("id1", "New", "2026-01-02T10:00:00.000Z"));

    const list = await server.fetch("/api/items", { headers: { Cookie: cookie } });
    const { items } = await list.json();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("New");
  });

  it("orders newest first by updated_at", async () => {
    await put(server, cookie, note("old", "Old", "2026-01-01T00:00:00.000Z"));
    await put(server, cookie, note("new", "New", "2026-03-01T00:00:00.000Z"));
    await put(server, cookie, note("mid", "Mid", "2026-02-01T00:00:00.000Z"));

    const list = await server.fetch("/api/items", { headers: { Cookie: cookie } });
    const { items } = await list.json();
    expect(items.map((i: any) => i.id)).toEqual(["new", "mid", "old"]);
  });

  it("delete removes the item and is idempotent", async () => {
    await put(server, cookie, note("id1", "First", "2026-01-01T00:00:00.000Z"));
    const del = await server.fetch("/api/items/id1", { method: "DELETE", headers: { Cookie: cookie } });
    expect(del.status).toBe(200);

    const again = await server.fetch("/api/items/id1", { method: "DELETE", headers: { Cookie: cookie } });
    expect(again.status).toBe(200);

    const list = await server.fetch("/api/items", { headers: { Cookie: cookie } });
    expect((await list.json()).items).toHaveLength(0);
  });

  it("rejects malformed JSON and implausible items", async () => {
    const bad = await server.fetch("/api/items/id1", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: "not json {",
    });
    expect(bad.status).toBe(400);

    for (const value of [null, 42, {}, { type: "note" }]) {
      const res = await server.fetch("/api/items/id1", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(value),
      });
      expect(res.status).toBe(400);
    }
  });

  it("rejects oversized payloads with 413", async () => {
    const huge = note("big", "x".repeat(310 * 1024), "2026-01-01T00:00:00.000Z");
    const res = await put(server, cookie, huge);
    expect(res.status).toBe(413);
  });

  it("skips corrupt rows instead of failing the list", async () => {
    await put(server, cookie, note("ok", "Fine", "2026-01-01T00:00:00.000Z"));
    await server.db
      .prepare("INSERT INTO items (id, payload, updated_at) VALUES (?, ?, ?)")
      .bind("bad", "{corrupt", "2026-02-01T00:00:00.000Z")
      .run();

    const list = await server.fetch("/api/items", { headers: { Cookie: cookie } });
    const { items } = await list.json();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("ok");
  });
});
