import React from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useItems } from "../hooks/useItems";
import { ThemeToggle } from "../components/ThemeToggle";
import { SearchOverlay } from "../components/SearchOverlay";
import { t, I18N } from "../i18n";

const navItems = [
  { to: "/", label: I18N.DASHBOARD_TITLE, icon: "🏠" },
  { to: "/items", label: I18N.ALL_ITEMS, icon: "📄" },
  { to: "/links", label: I18N.LINKS, icon: "🔗" },
  { to: "/notes", label: I18N.NOTES, icon: "📝" },
  { to: "/snippets", label: I18N.SNIPPETS, icon: "💻" },
  { to: "/credentials", label: I18N.CREDENTIALS, icon: "🔐" },
  { to: "/favorites", label: I18N.FAVORITES, icon: "⭐" },
  { to: "/tags", label: I18N.TAGS, icon: "🏷️" },
  { to: "/archive", label: I18N.ARCHIVE, icon: "🗄️" },
  { to: "/settings", label: I18N.SETTINGS, icon: "⚙️" },
];

export default function AppLayout() {
  const { items } = useItems();

  return (
    <div className="min-h-screen bg-[var(--color-canvas)] text-[var(--color-text)]">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[60] focus:rounded-md focus:bg-[var(--color-card)] focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <div className="flex">
        <aside className="hidden min-h-screen w-64 shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-card)] md:flex">
          <div className="p-4 text-lg font-bold">{t(I18N.APP_NAME)}</div>
          <nav aria-label="Primary" className="flex-1 space-y-1 px-2">
            {navItems.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.to === "/"}
                className={({ isActive }) =>
                  `flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                    isActive
                      ? "bg-[var(--ctp-surface1)] font-medium"
                      : "hover:bg-[var(--ctp-surface0)]"
                  }`
                }
              >
                <span aria-hidden="true">{n.icon}</span>
                <span>{t(n.label)}</span>
              </NavLink>
            ))}
          </nav>
          <div className="space-y-2 p-3">
            <ThemeToggle />
          </div>
        </aside>
        <main id="main-content" className="min-w-0 flex-1 p-4 pb-20 md:p-8 md:pb-8">
          <div className="mx-auto w-full max-w-5xl">
            <Outlet />
          </div>
        </main>
      </div>
      {/* bottom nav mobile — all sections, horizontally scrollable */}
      <nav
        aria-label="Primary"
        className="fixed bottom-0 left-0 right-0 flex gap-1 overflow-x-auto border-t border-[var(--color-border)] bg-[var(--color-card)] p-2 md:hidden"
      >
        {navItems.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === "/"}
            className={({ isActive }) =>
              `flex min-w-14 flex-col items-center rounded-md px-2 py-1 text-[11px] ${
                isActive ? "bg-[var(--ctp-surface1)] font-medium" : ""
              }`
            }
          >
            <span aria-hidden="true" className="text-base">{n.icon}</span>
            <span>{t(n.label)}</span>
          </NavLink>
        ))}
      </nav>
      <SearchOverlay items={items} />
    </div>
  );
}
