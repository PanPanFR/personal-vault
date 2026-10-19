// Client for the vault API.
//
// Same-origin fetch with cookie credentials. A 401 anywhere means the session
// died: broadcast `pv:logout` so the app swaps to the login screen, then throw
// AuthError so callers abort.
import type { ItemWithId } from "../lib/types";

export class AuthError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "AuthError";
  }
}

export const LOGOUT_EVENT = "pv:logout";

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(path, { credentials: "same-origin", ...init });
  if (response.status === 401) {
    window.dispatchEvent(new Event(LOGOUT_EVENT));
    throw new AuthError();
  }
  return response;
}

/** Cheap gate check; never throws — network failure means "not authed". */
export async function getSession(): Promise<boolean> {
  try {
    const res = await fetch("/api/session", { credentials: "same-origin" });
    if (!res.ok) return false;
    const data = (await res.json()) as { authenticated?: boolean };
    return data.authenticated === true;
  } catch {
    return false;
  }
}

export async function login(password: string): Promise<boolean> {
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  } catch {
    // cookie may already be dead — the point is to end up logged out locally
  }
}

export async function fetchItems(): Promise<ItemWithId[]> {
  const res = await apiFetch("/api/items");
  const data = (await res.json()) as { items: ItemWithId[] };
  return data.items;
}

export async function putItem(item: ItemWithId): Promise<void> {
  const res = await apiFetch(`/api/items/${encodeURIComponent(item.id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(item),
  });
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
}

export async function deleteItem(id: string): Promise<void> {
  const res = await apiFetch(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`delete failed: ${res.status}`);
}
