// Test harness: routes requests straight to Pages Functions handlers with an
// in-memory sqlite D1. Same-origin, no network.
import { createMockD1, type D1Database } from "./mock-d1";
import { onRequestPost as handleLogin } from "../../functions/api/login";
import { onRequestGet as handleSession } from "../../functions/api/session";
import { onRequestPost as handleLogout } from "../../functions/api/logout";
import { onRequestGet as handleItemsList } from "../../functions/api/items/index";
import {
  onRequestPut as handleItemPut,
  onRequestDelete as handleItemDelete,
} from "../../functions/api/items/[id]";

export const TEST_PASSWORD = "correct-horse-battery";

export class TestServer {
  public db: D1Database;

  constructor() {
    this.db = createMockD1();
  }

  public async fetch(urlStr: string, init?: RequestInit): Promise<Response> {
    const url = new URL(urlStr, "https://personal-vault.pages.dev");
    const pathname = url.pathname;
    const method = (init?.method ?? "GET").toUpperCase();

    const request = new Request(url.toString(), init);
    const env = { DB: this.db, PV_PASSWORD: TEST_PASSWORD };
    const baseContext = { request, env, data: {}, waitUntil: () => {}, next: () => Promise.resolve(new Response()) };

    if (pathname === "/api/login" && method === "POST") {
      return handleLogin({ ...baseContext, params: {}, functionPath: "/api/login" } as any);
    }

    if (pathname === "/api/session" && method === "GET") {
      return handleSession({ ...baseContext, params: {}, functionPath: "/api/session" } as any);
    }

    if (pathname === "/api/logout" && method === "POST") {
      return handleLogout({ ...baseContext, params: {}, functionPath: "/api/logout" } as any);
    }

    if (pathname === "/api/items" && method === "GET") {
      return handleItemsList({ ...baseContext, params: {}, functionPath: "/api/items" } as any);
    }

    const itemMatch = pathname.match(/^\/api\/items\/([^/]+)$/);
    if (itemMatch && method === "PUT") {
      return handleItemPut({
        ...baseContext,
        params: { id: itemMatch[1] },
        functionPath: "/api/items/[id]",
      } as any);
    }
    if (itemMatch && method === "DELETE") {
      return handleItemDelete({
        ...baseContext,
        params: { id: itemMatch[1] },
        functionPath: "/api/items/[id]",
      } as any);
    }

    return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
  }

  /** Log in and return the Cookie header value for subsequent requests. */
  public async login(password: string = TEST_PASSWORD): Promise<string> {
    const res = await this.fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) throw new Error(`login failed: ${res.status}`);
    const setCookie = res.headers.get("Set-Cookie") ?? "";
    const cookie = setCookie.split(";")[0];
    if (!cookie) throw new Error("no session cookie in login response");
    return cookie;
  }

  public close(): void {
    this.db.close();
  }
}
