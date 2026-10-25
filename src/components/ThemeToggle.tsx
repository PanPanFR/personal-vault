import { useTheme } from "../hooks/useTheme";
import { t, I18N } from "../i18n";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={t(I18N.THEME_TOGGLE)}
      className="rounded-md px-3 py-2 text-sm hover:bg-[var(--ctp-surface0)]"
    >
      {theme === "dark" ? "🌙" : "☀️"} {t(I18N.THEME_TOGGLE)}
    </button>
  );
}