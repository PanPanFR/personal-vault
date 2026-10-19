import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App";
import { AuthProvider } from "../../src/hooks/useAuth";
import { setLocale } from "../../src/i18n";

/**
 * Accessibility + responsive shell pass.
 * App is behind the auth gate now, so every render mocks the API: an
 * authenticated session and an empty vault.
 */

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/session")) return jsonResponse({ authenticated: true });
      if (url.includes("/api/items")) return jsonResponse({ items: [] });
      return new Response("not found", { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderApp(route = "/") {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("accessibility shell", () => {
  test("primary navigation is a labelled landmark on desktop and mobile", async () => {
    renderApp("/");
    await screen.findAllByRole("navigation", { name: /primary/i });
    const navs = screen.getAllByRole("navigation", { name: /primary/i });
    expect(navs.length).toBeGreaterThanOrEqual(1);
  });

  test("a skip link points at the main content region", async () => {
    renderApp("/");
    await screen.findAllByRole("navigation", { name: /primary/i });
    const skip = screen.getByRole("link", { name: /skip to content/i });
    expect(skip).toHaveAttribute("href", "#main-content");
    const main = document.querySelector("#main-content");
    expect(main).not.toBeNull();
    expect(main?.tagName).toBe("MAIN");
  });

  test("every Settings control is programmatically labelled", async () => {
    setLocale("en");
    renderApp("/settings");
    await screen.findByRole("heading", { level: 1, name: "Settings" });
    for (const label of ["Theme", "Language / Bahasa"]) {
      expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole("button", { name: "Log out" }).length).toBeGreaterThan(0);
  });

  test("headings give Settings a document outline", async () => {
    renderApp("/settings");
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Settings");
  });

  test("layout renders both the desktop sidebar and the mobile bottom bar", async () => {
    renderApp("/");
    await screen.findAllByRole("navigation", { name: /primary/i });
    const navs = screen.getAllByRole("navigation", { name: /primary/i });
    // Two renderings of the same nav: md sidebar + mobile bar.
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      expect(within(nav).getAllByRole("link").length).toBeGreaterThan(5);
    }
  });
});
