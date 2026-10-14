import { useCallback, useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  if (theme === "light") root.classList.add("light");
  if (theme === "dark") root.classList.add("dark");
  if (theme === "system") {
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) root.classList.add("dark");
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem("pv-theme") as Theme) || "system");

  useEffect(() => {
    applyTheme(theme);
    localStorage.setItem("pv-theme", theme);
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("pv-theme", next);
      applyTheme(next);
      return next;
    });
  }, []);

  return { theme, setTheme, toggle };
}