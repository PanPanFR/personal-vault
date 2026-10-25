// Settings — deliberately small: appearance, account, about.
import { useState } from "react";
import { Card } from "../components/ui/Card";
import { Select } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { UpdateNotice } from "../components/UpdateNotice";
import { useTheme, type Theme } from "../hooks/useTheme";
import { useAuth } from "../hooks/useAuth";
import { I18N, t, getLocale, setLocale } from "../i18n";
import type { Locale } from "../i18n/keys";

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const { logout } = useAuth();
  const [locale, setLocaleState] = useState<Locale>(() => getLocale());

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{t(I18N.SETTINGS)}</h1>
      <UpdateNotice />

      <Card>
        <h2 className="mb-4 text-lg font-semibold">{t(I18N.SETTINGS_APPEARANCE)}</h2>
        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t(I18N.SETTINGS_THEME_LABEL)}</span>
            <Select
              aria-label={t(I18N.SETTINGS_THEME_LABEL)}
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
            >
              <option value="system">{t(I18N.SETTINGS_THEME_SYSTEM)}</option>
              <option value="light">{t(I18N.SETTINGS_THEME_LIGHT)}</option>
              <option value="dark">{t(I18N.SETTINGS_THEME_DARK)}</option>
            </Select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t(I18N.LOCALE_LABEL)}</span>
            <Select
              aria-label={t(I18N.LOCALE_LABEL)}
              value={locale}
              onChange={(e) => {
                const next = e.target.value as Locale;
                setLocale(next);
                setLocaleState(next);
              }}
            >
              <option value="en">English</option>
              <option value="id">Bahasa Indonesia</option>
            </Select>
          </label>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">{t(I18N.SETTINGS_ACCOUNT)}</h2>
        <Button variant="danger" onClick={() => void logout()}>
          {t(I18N.LOGOUT)}
        </Button>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">{t(I18N.SETTINGS_ABOUT)}</h2>
        <dl className="mb-3 flex gap-2 text-sm">
          <dt className="font-medium">{t(I18N.SETTINGS_VERSION)}</dt>
          <dd data-testid="app-version">{__APP_VERSION__}</dd>
        </dl>
        <p className="text-sm text-[var(--color-muted)]">{t(I18N.SETTINGS_PRIVACY)}</p>
      </Card>
    </div>
  );
}
