import React from "react";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { SyncStatusPlaceholder } from "../components/SyncStatusPlaceholder";
import { useTheme, type Theme } from "../hooks/useTheme";
import { Select } from "../components/ui/Input";
import { I18N, t } from "../i18n";

/**
 * Settings shell. This plan owns layout + theme control only; the PWA plan
 * fills final copy, and the crypto plan populates the ID+EN dictionaries
 * for the frozen key constants.
 */
export default function Settings() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t(I18N.SETTINGS)}</h1>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <label className="block text-sm font-medium mb-1" htmlFor="theme-select">
          Theme
        </label>
        <Select
          id="theme-select"
          value={theme}
          onChange={(e) => setTheme(e.target.value as Theme)}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </Select>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Language</CardTitle>
        </CardHeader>
        <p className="text-sm text-[var(--color-muted)]">
          Bilingual ID + EN support lands with the crypto plan dictionaries.
          Keys are frozen in src/i18n/keys.ts.
        </p>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t(I18N.SYNC_STATUS)}</CardTitle>
        </CardHeader>
        <SyncStatusPlaceholder />
      </Card>
    </div>
  );
}
