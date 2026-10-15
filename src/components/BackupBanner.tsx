/**
 * Aggressive iOS export banner (PRD §5 G11, pwa-operational §2.3).
 *
 * Default (plan decision): on iOS/iPadOS the banner is PERSISTENT and can only
 * be dismissed once an encrypted export exists (`last_export_at` set). Before
 * that it is announced on every Dashboard / Settings mount — WebKit may delete
 * local data after ~7 days without an app visit.
 */
import React, { useCallback, useState } from "react";
import { I18N, t } from "../i18n";
import { isIOS } from "../pwa/platform";
import { readSettings } from "../settings/store";

export interface BackupBannerProps {
  /** Force-show for the Settings surface even when storage says "exported". */
  variant?: "dashboard" | "settings";
  lastExportAt?: string | null;
  isIos?: boolean;
  onExport?: () => void;
}

export function BackupBanner({
  variant = "dashboard",
  lastExportAt,
  isIos,
  onExport,
}: BackupBannerProps) {
  const ios = isIos ?? isIOS();
  const exportedAt = lastExportAt === undefined ? readSettings().last_export_at : lastExportAt;
  const reminderNeeded = exportedAt === null;
  const [dismissed, setDismissed] = useState(false);

  // Non-iOS surfaces only carry the gentle reminder; iOS is the aggressive case.
  const showIosBanner = ios && reminderNeeded && !dismissed;
  const showGentleBanner = !ios && variant === "settings" && reminderNeeded && !dismissed;
  if (!showIosBanner && !showGentleBanner) return null;

  return (
    <section
      role="alert"
      aria-live={showIosBanner ? "assertive" : "polite"}
      data-testid="backup-banner"
      data-variant={showIosBanner ? "ios-persistent" : "gentle"}
      className={`mb-4 rounded-lg border p-3 text-sm ${
        showIosBanner
          ? "border-amber-500/60 bg-amber-500/10 text-amber-900 dark:text-amber-100"
          : "border-[var(--color-border)] bg-[var(--ctp-surface0)] text-[var(--color-muted)]"
      }`}
    >
      <p className="font-semibold">{t(I18N.BACKUP_BANNER_TITLE)}</p>
      <p className="mt-1">{t(I18N.BACKUP_BANNER_BODY)}</p>
      <p className="mt-1 text-xs opacity-80">{t(I18N.BACKUP_BANNER_EVICTION_NOTE)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {onExport ? (
          <button
            type="button"
            onClick={onExport}
            className="rounded bg-amber-500/20 px-2.5 py-1 text-xs font-semibold hover:bg-amber-500/30"
          >
            {t(I18N.BACKUP_BANNER_EXPORT)}
          </button>
        ) : (
          <a
            href="/settings"
            className="rounded bg-amber-500/20 px-2.5 py-1 text-xs font-semibold hover:bg-amber-500/30"
          >
            {t(I18N.BACKUP_BANNER_EXPORT)}
          </a>
        )}
        {exportedAt && (
          <span className="text-xs opacity-80">
            {t(I18N.BACKUP_LAST_EXPORT)}: {exportedAt}
          </span>
        )}
        {/* Dismissal unlocks only after an export exists (plan default). */}
        {!reminderNeeded && (
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="rounded px-2 py-1 text-xs underline"
          >
            {t(I18N.CLOSE)}
          </button>
        )}
      </div>
    </section>
  );
}

/** Convenience wrapper for the Settings page (export handler supplied there). */
export function useBackupBannerDismissal(): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(false);
  const reset = useCallback(() => setDismissed(false), []);
  return [dismissed, reset];
}