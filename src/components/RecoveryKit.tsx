// Recovery-kit download + save-confirmation gate. Setup/rotation MUST NOT
// complete while `confirmed` is false — parents disable their Continue
// buttons on this flag.
import React, { useState } from "react";
import { Button } from "./ui/Button";
import { I18N, t } from "../i18n";
import type { RecoveryKit } from "../crypto/recovery";
import { serializeRecoveryKit } from "../crypto/recovery";
import { RECOVERY_KIT_FILENAME } from "../lib/limits";

export function RecoveryKitCard({
  kit,
  base32,
  onConfirmedChange,
}: {
  kit: RecoveryKit;
  base32: string;
  onConfirmedChange: (confirmed: boolean) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);

  const download = () => {
    const blob = new Blob([serializeRecoveryKit(kit)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = RECOVERY_KIT_FILENAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-6" data-testid="recovery-kit">
      <h2 className="text-lg font-semibold">{t(I18N.RECOVERY_KIT_TITLE)}</h2>
      <Button type="button" variant="secondary" onClick={download}>
        {t(I18N.RECOVERY_KIT_DOWNLOAD)}
      </Button>
      <p className="break-all font-mono text-xs" data-testid="recovery-base32">
        {base32}
      </p>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => {
            setConfirmed(e.target.checked);
            onConfirmedChange(e.target.checked);
          }}
          aria-label={t(I18N.RECOVERY_KIT_CONFIRM_LABEL)}
        />
        <span>{t(I18N.RECOVERY_KIT_CONFIRM_LABEL)}</span>
      </label>
      {confirmed && <p className="text-sm">{t(I18N.RECOVERY_KIT_CONFIRMED)}</p>}
    </div>
  );
}
