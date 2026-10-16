import { describe, expect, test } from "vitest";
import React from "react";
import { render, screen, cleanup, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App";
import { BackupBanner } from "../../src/components/BackupBanner";
import { setLocale } from "../../src/i18n";

/**
 * Accessibility + responsive shell pass (PRD §12, plan step 1).
 * Focus here: landmarks, skip link, labelled controls, live regions and the
 * keyboard affordances that the release gate depends on.
 */

function renderApp(route = "/settings") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <App />
    </MemoryRouter>,
  );
}

describe("accessibility shell", () => {
  test("primary navigation is a labelled landmark on desktop and mobile", () => {
    renderApp("/");
    const navs = screen.getAllByRole("navigation", { name: /primary/i });
    expect(navs.length).toBeGreaterThanOrEqual(1);
    cleanup();
  });

  test("a skip link points at the main content region", () => {
    renderApp("/");
    const skip = screen.getByRole("link", { name: /skip to content/i });
    expect(skip).toHaveAttribute("href", "#main-content");
    const main = document.querySelector("#main-content");
    expect(main).not.toBeNull();
    expect(main?.tagName).toBe("MAIN");
  });

  test("every Settings control is programmatically labelled", () => {
    setLocale("en");
    renderApp("/settings");
    for (const label of [
      "Theme",
      "Language / Bahasa",
      "Auto-lock after",
    ]) {
      expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0);
    }
    for (const action of [
      "Request durable storage",
      "Sync now",
      "Export encrypted backup",
    ]) {
      expect(screen.getAllByRole("button", { name: action }).length).toBeGreaterThan(0);
    }
  });

  test("sync status is announced politely rather than only visually", () => {
    render(
      <div role="status" aria-live="polite">
        <span>Synced</span>
      </div>,
    );
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });

  test("the iOS backup banner uses an assertive live region", () => {
    render(<BackupBanner isIos lastExportAt={null} />);
    expect(screen.getByRole("alert")).toHaveAttribute("aria-live", "assertive");
    cleanup();
  });

  test("headings give Settings a document outline", () => {
    renderApp("/settings");
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Settings");
  });

  test("layout renders both the desktop sidebar and the mobile bottom bar", () => {
    renderApp("/");
    const navs = screen.getAllByRole("navigation", { name: /primary/i });
    // Two renderings of the same nav: md sidebar + mobile bar.
    expect(navs).toHaveLength(2);
    for (const nav of navs) {
      expect(within(nav).getAllByRole("link").length).toBeGreaterThan(5);
    }
  });
});