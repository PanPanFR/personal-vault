import React from "react";
import { I18N, t } from "../i18n";

export function SyncStatusPlaceholder() {
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--ctp-crust)] px-3 py-2 text-xs text-[var(--color-muted)]">
      {t(I18N.SYNC_STATUS)}: {t(I18N.NOT_CONNECTED)}
    </div>
  );
}