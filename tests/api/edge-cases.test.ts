// @vitest-environment node
// Adversarial edge cases for the simple vault API. Happy paths live in
// auth.test.ts / items.test.ts; this suite hunts boundary behavior.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer } from "../helpers/test-harness";
import { resetRateLimiter } from "../../functions/api/login";

const MAX_BODY_BYTES = 300 * 1024;

function note(id: string, title: string, updatedAt = "2026-01-01T00:00:00.000Z") {
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

function putRaw(server: TestServer, cookie: string, id: string, body: string, contentType = "application/json") {
  return server.fetch(`/api/items/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": contentType, Cookie: cookie },
    body,
  });
}

function putItem(server: TestServer, cookie: string, item: object) {
  return putRaw(server, cookie, (item as any).id, JSON.stringify(item));
}

/** Build a body whose UTF-8 size is exactly `targetBytes` (ASCII filler). */
function sizedBody(targetBytes: number, id: string): string {
  const base = note(id, "");
  let s = JSON.stringify(base);
  const pad = targetBytes - s.length;
  if (pad < 0) throw new Error("target too small for base shape");
  base.title = "x".repeat(pad);
  s = JSON.stringify(base);
  if (new TextEncoder().encode(s).length !== targetBytes) {
    throw new Error("size construction drifted");
  }
  return s;
}

describe("adversarial edge cases", () => {
  let server: TestServer;
  let cookie: string;
  let token: string;

  beforeEach(async () => {
    resetRateLimiter();
    server = new TestServer();
    cookie = await server.login();
    token = cookie.split("=")[1];
  });

  afterEach(() => {
    server.close();
  });

  describe("cookie tampering", () => {
    it("rejects unknown, empty and malformed tokens", async () => {
      for (const bad of ["pv_session=deadbeef", "pv_session=", "pv_session=%20%20", "pv_session=" + "0".repeat(64)]) {
        const res = await server.fetch("/api/items", { headers: { Cookie: bad } });
        expect(res.status).toBe(401);
      }
    });

    it("last duplicate pv_session param wins (matching cookie parsing semantics)", async () => {
      const validLast = await server.fetch("/api/items", {
        headers: { Cookie: `pv_session=garbage; pv_session=${token}` },
      });
      expect(validLast.status).toBe(200);

      const garbageLast = await server.fetch("/api/items", {
        headers: { Cookie: `pv_session=${token}; pv_session=garbage` },
      });
      expect(garbageLast.status).toBe(401);
    });

    it("percent-encoded token decodes before lookup (no accidental match)", async () => {
      const res = await server.fetch("/api/items", {
        headers: { Cookie: "pv_session=%2D%2Ddeadbeef--" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("session expiry boundary", () => {
    it("expires_at === now is already invalid; one second later is valid", async () => {
      await server.db
        .prepare("UPDATE sessions SET expires_at = ?")
        .bind(new Date().toISOString())
        .run();
      const atNow = await server.fetch("/api/session", { headers: { Cookie: cookie } });
      expect((await atNow.json()).authenticated).toBe(false);

      await server.db
        .prepare("UPDATE sessions SET expires_at = ?")
        .bind(new Date(Date.now() + 1000).toISOString())
        .run();
      const future = await server.fetch("/api/session", { headers: { Cookie: cookie } });
      expect((await future.json()).authenticated).toBe(true);
    });
  });

  describe("logout is forgiving", () => {
    it("returns 200 with no cookie and with a garbage cookie", async () => {
      const none = await server.fetch("/api/logout", { method: "POST" });
      expect(none.status).toBe(200);

      const garbage = await server.fetch("/api/logout", {
        method: "POST",
        headers: { Cookie: "pv_session=nah" },
      });
      expect(garbage.status).toBe(200);
    });
  });

  describe("PUT validation", () => {
    it("rejects payload.id that disagrees with the path id (no row written)", async () => {
      const res = await putItem(server, cookie, note("path-id", "x"));
      const mismatch = await putRaw(server, cookie, "path-id", JSON.stringify(note("other-id", "x")));
      expect(res.status).toBe(200); // sanity: matching ids pass
      expect(mismatch.status).toBe(400);
      expect((await mismatch.json()).error).toBe("id_mismatch");

      const list = await server.fetch("/api/items", { headers: { Cookie: cookie } });
      const { items } = await list.json();
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("path-id");
    });

    it("accepts valid JSON regardless of Content-Type", async () => {
      const res = await putRaw(server, cookie, "ct", JSON.stringify(note("ct", "plain")), "text/plain");
      expect(res.status).toBe(200);
    });

    it("body gate is byte-exact: 300 KiB passes, 300 KiB + 1 fails", async () => {
      const atLimit = await putRaw(server, cookie, "sized-ok", sizedBody(MAX_BODY_BYTES, "sized-ok"));
      expect(atLimit.status).toBe(200);

      const over = await putRaw(server, cookie, "sized-over", sizedBody(MAX_BODY_BYTES + 1, "sized-over"));
      expect(over.status).toBe(413);
    });

    it("roundtrips unicode titles and arbitrary extra fields verbatim", async () => {
      const item = {
        ...note("uni-1", "🏦 銀行 안녕 — \"quotes\" \\ slash"),
        body: "emoji 🎉 CJK 漢字 RTL עברית",
        custom_field: { nested: true, list: [1, "two"] },
        extra_num: 7,
      };
      expect((await putItem(server, cookie, item)).status).toBe(200);

      const list = await server.fetch("/api/items", { headers: { Cookie: cookie } });
      const { items } = await list.json();
      expect(items).toHaveLength(1);
      expect(items[0]).toEqual(item);
    });
  });

  describe("robustness", () => {
    it("returns an empty list when every row is corrupt", async () => {
      for (const id of ["c1", "c2"]) {
        await server.db
          .prepare("INSERT INTO items (id, payload, updated_at) VALUES (?, ?, ?)")
          .bind(id, "{nope", "2026-01-01T00:00:00.000Z")
          .run();
      }
      const res = await server.fetch("/api/items", { headers: { Cookie: cookie } });
      expect(res.status).toBe(200);
      expect((await res.json()).items).toEqual([]);
    });

    it("handles ids with URL-special characters end to end", async () => {
      const id = "a b%c";
      expect((await putItem(server, cookie, note(id, "special"))).status).toBe(200);

      const list = await server.fetch("/api/items", { headers: { Cookie: cookie } });
      expect((await list.json()).items[0].id).toBe(id);

      const del = await server.fetch(`/api/items/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Cookie: cookie },
      });
      expect(del.status).toBe(200);
      const after = await server.fetch("/api/items", { headers: { Cookie: cookie } });
      expect((await after.json()).items).toHaveLength(0);
    });

    it("unknown routes fall through to a 404 envelope", async () => {
      const res = await server.fetch("/api/nope");
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("not_found");
    });
  });
});
