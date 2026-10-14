// Lock screen — manual lock + passphrase unlock. Failed attempts fail
// closed (no wipe). Shows timeout options 1/5/15/30 (default 5).
import React, { useState } from "react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { I18N, t } from "../i18n";
import { LOCK_TIMEOUT_OPTIONS } from "../vault/session";

export function LockScreen({
  onUnlock,
  error,
  busy,
}: {
  onUnlock: (passphrase: string) => void;
  error?: string | null;
  busy?: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ctp-base)] p-6"
      data-testid="lock-screen"
    >
      <form
        className="w-full max-w-sm space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-6"
        onSubmit={(e) => {
          e.preventDefault();
          onUnlock(value);
        }}
      >
        <h1 className="text-xl font-bold">{t(I18N.LOCKED_TITLE)}</h1>
        <p className="text-sm text-[var(--color-muted)]">{t(I18N.LOCKED_DESC)}</p>
        <label className="block text-sm font-medium" htmlFor="lock-passphrase">
          {t(I18N.PASSPHRASE_LABEL)}
        </label>
        <Input
          id="lock-passphrase"
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t(I18N.PASSPHRASE_PLACEHOLDER)}
        />
        {error && (
          <p role="alert" className="text-sm text-[var(--color-error)]">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || value.length === 0} className="w-full">
          {t(I18N.UNLOCK)}
        </Button>
      </form>
    </div>
  );
}

export function LockTimeoutSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{t(I18N.LOCK_TIMEOUT_LABEL)}</span>
      <select
        aria-label={t(I18N.LOCK_TIMEOUT_LABEL)}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--ctp-base)] px-3 text-sm"
      >
        {LOCK_TIMEOUT_OPTIONS.map((m) => (
          <option key={m} value={m}>
            {m} min
          </option>
        ))}
      </select>
    </label>
  );
}
