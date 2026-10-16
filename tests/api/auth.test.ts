// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestServer, TEST_PASSWORD } from "../helpers/test-harness";
import { resetRateLimiter } from "../../functions/api/login";
import { sessionCookie, clearedCookie } from "../../functions/_shared/auth";

describe("auth: login / session / logout", () => {
  let server: TestServer;

  beforeEach(() => {
    resetRateLimiter();
    server = new TestServer();
  });

  afterEach(() => {
    server.close();
  });

  it("correct password sets an HttpOnly session cookie and creates a session row", async () => {
    const res = await server.fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    expect(res.status).toBe(200);

    const setCookie = res.headers.get("Set-Cookie") ?? "";
    expect(setCookie).toContain("pv_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Secure"); // harness serves https

    const row = await server.db
      .prepare("SELECT COUNT(*) as n FROM sessions")
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
  });

  it("wrong password returns 401 wrong_password and creates no session", async () => {
    const res = await server.fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "nope" }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("wrong_password");
    const row = await server.db.prepare("SELECT COUNT(*) as n FROM sessions").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("missing or malformed body is rejected without a session", async () => {
    for (const body of ["not json", JSON.stringify({}), JSON.stringify({ password: 42 })]) {
      const res = await server.fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      expect(res.status).toBe(401);
    }
  });

  it("session endpoint reflects cookie validity", async () => {
    const anon = await server.fetch("/api/session");
    expect((await anon.json()).authenticated).toBe(false);

    const cookie = await server.login();
    const authed = await server.fetch("/api/session", { headers: { Cookie: cookie } });
    expect((await authed.json()).authenticated).toBe(true);
  });

  it("expired sessions are rejected", async () => {
    const cookie = await server.login();
    await server.db
      .prepare("UPDATE sessions SET expires_at = ?")
      .bind(new Date(Date.now() - 1000).toISOString())
      .run();
    const res = await server.fetch("/api/session", { headers: { Cookie: cookie } });
    expect((await res.json()).authenticated).toBe(false);
  });

  it("logout destroys the session and clears the cookie", async () => {
    const cookie = await server.login();
    const res = await server.fetch("/api/logout", { method: "POST", headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");

    const after = await server.fetch("/api/session", { headers: { Cookie: cookie } });
    expect((await after.json()).authenticated).toBe(false);
    const row = await server.db.prepare("SELECT COUNT(*) as n FROM sessions").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("rate limits repeated failures per IP (10 attempts / window)", async () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 10; i++) {
      const res = await server.fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
        body: JSON.stringify({ password: `guess-${i}` }),
      });
      expect(res.status).toBe(401);
    }
    const blocked = await server.fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    expect(blocked.status).toBe(429);

    // A different IP is unaffected.
    const other = await server.fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "198.51.100.7" },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    expect(other.status).toBe(200);
  });

  it("successful login clears the failure counter", async () => {
    const ip = "203.0.113.10";
    for (let i = 0; i < 9; i++) {
      await server.fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
        body: JSON.stringify({ password: `guess-${i}` }),
      });
    }
    const ok = await server.fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ password: TEST_PASSWORD }),
    });
    expect(ok.status).toBe(200);
  });

  it("cookie builders: Secure only on https, cleared cookie expires immediately", () => {
    expect(sessionCookie("tok", true)).toContain("Secure");
    expect(sessionCookie("tok", false)).not.toContain("Secure");
    expect(clearedCookie(true)).toContain("Max-Age=0");
  });

  it("login is not configurable when PV_PASSWORD is missing", async () => {
    const request = new Request("https://x/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "anything" }),
    });
    const { onRequestPost } = await import("../../functions/api/login");
    const res = await onRequestPost({
      request,
      env: { DB: server.db },
      params: {},
      data: {},
      waitUntil: () => {},
      next: () => Promise.resolve(new Response()),
      functionPath: "/api/login",
    } as any);
    expect(res.status).toBe(500);
  });
});
