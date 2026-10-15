import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardHeader, CardTitle } from "../components/ui/Card";
import { Select, Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { SyncStatus } from "../components/SyncStatus";
import { BackupBanner } from "../components/BackupBanner";
import { UpdateNotice } from "../components/UpdateNotice";
import { useTheme, type Theme } from "../hooks/useTheme";
import { I18N, t, tf, getLocale, setLocale } from "../i18n";
import type { Locale } from "../i18n/keys";
import { LOCK_TIMEOUT_OPTIONS, updateLockTimeout, type LockTimeoutMinutes } from "../vault/session";
import {
  readSettings,
  persistSetting,
  markExported,
  type Settings,
  type ThemePreference,
} from "../settings/store";
import {
  formatBytes,
  readStorageStatus,
  requestPersistentStorage,
  type StorageStatus,
} from "../settings/storage-status";
import {
  DISCONNECTED_STATUS,
  getSyncRuntime,
  type SyncRuntime,
} from "../sync/runtime";
import type { SyncEngineStatus } from "../sync/types";
import type { DeviceSummary } from "../sync/client";

/**
 * Settings — this plan owns the final copy (plan/pwa-hardening-release.md step 5).
 * Frozen field names: `lock_timeout`, `theme`, `locale`, `last_export_at`.
 */
export default function Settings() {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<Settings>(() => readSettings());
  const [locale, setLocaleState] = useState<Locale>(() => getLocale());
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncEngineStatus>(DISCONNECTED_STATUS);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});

  const runtime: SyncRuntime | null = useMemo(() => getSyncRuntime(), []);

  const refreshStorage = useCallback(async () => {
    setStorage(await readStorageStatus());
  }, []);

  const refreshDevices = useCallback(async () => {
    const client = runtime?.client;
    const credentials = runtime?.getCredentials() ?? null;
    if (!client || !credentials) return;
    try {
      setDevices(await client.listDevices(credentials));
    } catch {
      // Offline / revoked: the list simply stays as-is, with sync error visible.
    }
  }, [runtime]);

  useEffect(() => {
    void refreshStorage();
    void refreshDevices();
    if (!runtime) return;
    const unsubscribe = runtime.subscribe(setSyncStatus);
    void runtime.getStatus().then(setSyncStatus);
    return unsubscribe;
  }, [refreshDevices, refreshStorage, runtime]);

  const onLockTimeout = (value: string) => {
    const minutes = Number(value) as LockTimeoutMinutes;
    if (!Number.isFinite(minutes)) return;
    updateLockTimeout(minutes);
    persistSetting("lock_timeout", minutes);
    setSettings((prev) => ({ ...prev, lock_timeout: minutes }));
  };

  const onTheme = (value: string) => {
    setTheme(value as Theme);
    persistSetting("theme", value as ThemePreference);
    setSettings((prev) => ({ ...prev, theme: value as ThemePreference }));
  };

  const onLocale = (value: string) => {
    const next = value as Locale;
    setLocale(next);
    setLocaleState(next);
    persistSetting("locale", next);
    setSettings((prev) => ({ ...prev, locale: next }));
    document.documentElement.lang = next;
  };

  const onExport = () => {
    // Export/download wiring lives with the backup module; Settings only records
    // that an export happened so the iOS banner can retire.
    const at = markExported();
    setSettings((prev) => ({ ...prev, last_export_at: at }));
    setNotice(t(I18N.SETTINGS_EXPORT));
  };

  const onRename = async (device: DeviceSummary) => {
    const label = (renameDrafts[device.device_id] ?? "").trim();
    const client = runtime?.client;
    const credentials = runtime?.getCredentials() ?? null;
    if (!label || !client || !credentials) return;
    await client.renameDevice(device.device_id, label, credentials);
    setNotice(t(I18N.SETTINGS_DEVICE_RENAME_SAVED));
    await refreshDevices();
  };

  const onRevoke = async (device: DeviceSummary) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(t(I18N.SETTINGS_DEVICE_REVOKE_CONFIRM))
    ) {
      return;
    }
    const client = runtime?.client;
    const credentials = runtime?.getCredentials() ?? null;
    if (!client || !credentials) return;
    await client.revokeDevice(device.device_id, credentials);
    setNotice(t(I18N.SETTINGS_DEVICE_REVOKED));
    await refreshDevices();
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t(I18N.SETTINGS)}</h1>
      <UpdateNotice />
      <BackupBanner
        variant="settings"
        lastExportAt={settings.last_export_at}
        onExport={onExport}
      />

      {notice && (
        <p role="status" className="rounded-md border border-[var(--color-border)] px-3 py-2 text-xs">
          {notice}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t(I18N.SETTINGS_APPEARANCE)}</CardTitle>
        </CardHeader>
        <label className="mb-1 block text-sm font-medium" htmlFor="theme-select">
          {t(I18N.SETTINGS_THEME_LABEL)}
        </label>
        <Select
          id="theme-select"
          aria-label={t(I18N.SETTINGS_THEME_LABEL)}
          value={theme}
          onChange={(e) => onTheme(e.target.value)}
        >
          <option value="system">{t(I18N.SETTINGS_THEME_SYSTEM)}</option>
          <option value="light">{t(I18N.SETTINGS_THEME_LIGHT)}</option>
          <option value="dark">{t(I18N.SETTINGS_THEME_DARK)}</option>
        </Select>

        <label className="mb-1 mt-4 block text-sm font-medium" htmlFor="locale-select">
          {t(I18N.LOCALE_LABEL)}
        </label>
        <Select
          id="locale-select"
          aria-label={t(I18N.LOCALE_LABEL)}
          value={locale}
          onChange={(e) => onLocale(e.target.value)}
        >
          <option value="id">Bahasa Indonesia</option>
          <option value="en">English</option>
        </Select>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t(I18N.SETTINGS_SECURITY)}</CardTitle>
        </CardHeader>
        <label className="mb-1 block text-sm font-medium" htmlFor="lock-timeout-select">
          {t(I18N.SETTINGS_LOCK_TIMEOUT)}
        </label>
        <Select
          id="lock-timeout-select"
          aria-label={t(I18N.SETTINGS_LOCK_TIMEOUT)}
          value={String(settings.lock_timeout)}
          onChange={(e) => onLockTimeout(e.target.value)}
        >
          {LOCK_TIMEOUT_OPTIONS.map((minutes) => (
            <option key={minutes} value={String(minutes)}>
              {tf(I18N.SETTINGS_LOCK_TIMEOUT_MINUTES, { n: minutes }, locale)}
            </option>
          ))}
        </Select>
        <p className="mt-3 text-sm">{t(I18N.SETTINGS_CHANGE_PASSPHRASE)}</p>
        <p className="text-xs text-[var(--color-muted)]">
          {t(I18N.PASSWORD_CHANGE_DISCLOSURE_RECOVERY_KEPT)}
        </p>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t(I18N.SETTINGS_STORAGE)}</CardTitle>
        </CardHeader>
        <dl className="space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-[var(--color-muted)]">Persisted:</dt>
            <dd data-testid="storage-persisted">
              {storage?.persisted
                ? t(I18N.SETTINGS_STORAGE_PERSISTED)
                : t(I18N.SETTINGS_STORAGE_BEST_EFFORT)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-[var(--color-muted)]">{t(I18N.SETTINGS_STORAGE_USAGE)}:</dt>
            <dd data-testid="storage-usage">
              {formatBytes(storage?.usageBytes ?? null, locale)}
              {storage?.quotaBytes
                ? ` / ${formatBytes(storage.quotaBytes, locale)}`
                : ""}
            </dd>
          </div>
        </dl>
        <div className="mt-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={async () => {
              await requestPersistentStorage();
              await refreshStorage();
            }}
          >
            {t(I18N.SETTINGS_STORAGE_REQUEST)}
          </Button>
        </div>
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          {t(I18N.SETTINGS_STORAGE_EVICTION_NOTE)}
        </p>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t(I18N.SETTINGS_SYNC)}</CardTitle>
        </CardHeader>
        <SyncStatus
          status={syncStatus}
          onRetry={() => void runtime?.controller?.trigger("manual")}
        />
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex gap-2">
            <dt className="text-[var(--color-muted)]">{t(I18N.SETTINGS_SYNC_LAST)}:</dt>
            <dd data-testid="sync-last">
              {syncStatus.lastSyncTime ?? t(I18N.SETTINGS_SYNC_NONE)}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-[var(--color-muted)]">{t(I18N.SETTINGS_SYNC_PENDING)}:</dt>
            <dd data-testid="sync-pending">{syncStatus.pendingCount}</dd>
          </div>
          {syncStatus.lastError && (
            <div className="flex gap-2">
              <dt className="text-[var(--color-muted)]">{t(I18N.SETTINGS_SYNC_ERROR)}:</dt>
              <dd data-testid="sync-error" className="text-red-500">
                {syncStatus.lastError}
              </dd>
            </div>
          )}
        </dl>
        <p className="mt-2 text-xs text-[var(--color-muted)]">
          {t(I18N.SETTINGS_SYNC_OFFLINE_NOTE)}
        </p>
        <div className="mt-3">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void runtime?.controller?.trigger("manual")}
          >
            {t(I18N.SETTINGS_SYNC_NOW)}
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t(I18N.SETTINGS_DEVICES)}</CardTitle>
        </CardHeader>
        {devices.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">{t(I18N.SETTINGS_DEVICES_NONE)}</p>
        ) : (
          <ul className="space-y-3">
            {devices.map((device) => (
              <li key={device.device_id} className="rounded-md border border-[var(--color-border)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{device.label}</span>
                  {device.revoked_at ? (
                    <span className="text-xs text-red-500">{t(I18N.SETTINGS_DEVICE_REVOKED)}</span>
                  ) : (
                    <span className="text-xs text-[var(--color-muted)]">
                      {t(I18N.SETTINGS_DEVICE_LAST_SEEN)}: {device.last_seen_at ?? t(I18N.SETTINGS_DEVICE_LAST_SEEN_NEVER)}
                    </span>
                  )}
                </div>
                {!device.revoked_at && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      aria-label={`${t(I18N.SETTINGS_DEVICE_RENAME)} ${device.label}`}
                      value={renameDrafts[device.device_id] ?? ""}
                      onChange={(e) =>
                        setRenameDrafts((prev) => ({ ...prev, [device.device_id]: e.target.value }))
                      }
                      className="h-8 max-w-48"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void onRename(device)}
                    >
                      {t(I18N.SETTINGS_DEVICE_RENAME)}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      onClick={() => void onRevoke(device)}
                    >
                      {t(I18N.SETTINGS_DEVICE_REVOKE)}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t(I18N.SETTINGS_BACKUP)}</CardTitle>
        </CardHeader>
        <div className="space-y-2">
          <Button type="button" onClick={onExport}>
            {t(I18N.SETTINGS_EXPORT)}
          </Button>
          <p className="text-xs text-[var(--color-muted)]">{t(I18N.SETTINGS_EXPORT_HINT)}</p>
          <Button type="button" variant="secondary">
            {t(I18N.SETTINGS_IMPORT)}
          </Button>
          <p className="text-xs text-[var(--color-muted)]">
            {t(I18N.SETTINGS_IMPORT_HINT)} {t(I18N.SETTINGS_IMPORT_BLOCKED_NONEMPTY)}
          </p>
          <Button type="button" variant="secondary">
            {t(I18N.SETTINGS_ROTATE_RECOVERY)}
          </Button>
          <p className="text-xs text-[var(--color-muted)]">
            {t(I18N.SETTINGS_ROTATE_RECOVERY_HINT)} {t(I18N.SETTINGS_RECOVERY_GUIDANCE)}
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            {t(I18N.BACKUP_LAST_EXPORT)}: {settings.last_export_at ?? t(I18N.SETTINGS_SYNC_NONE)}
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t(I18N.SETTINGS_ABOUT)}</CardTitle>
        </CardHeader>
        <dl className="space-y-2 text-sm">
          <div className="flex gap-2">
            <dt className="text-[var(--color-muted)]">{t(I18N.SETTINGS_VERSION)}:</dt>
            <dd data-testid="app-version">{__APP_VERSION__}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-[var(--color-muted)]">{t(I18N.SETTINGS_PRIVACY)}</p>
        <p className="mt-2 text-xs">
          <strong>{t(I18N.SETTINGS_LIMITATIONS)}:</strong> {t(I18N.SETTINGS_LIMITATIONS_BODY)}
        </p>
      </Card>
    </div>
  );
}