// Credential field UX: masked by default, explicit reveal + copy-on-gesture,
// clipboard retention warning. Passphrase field: min-8 hint + strength +
// offline-guess disclosure.
import React, { useState } from "react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { I18N, t } from "../i18n";
import { estimatePassphraseStrength } from "../vault/passphrase";
import { PASSPHRASE_MIN_LENGTH } from "../lib/limits";

export function CredentialField({
  label,
  value,
  fieldId,
}: {
  label: string;
  value: string;
  fieldId: string;
}) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    // Clipboard only after explicit user gesture (button click).
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium" htmlFor={fieldId}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Input
          id={fieldId}
          readOnly
          type={revealed ? "text" : "password"}
          value={revealed ? value : t(I18N.MASKED)}
          aria-label={label}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setRevealed((v) => !v)}
          aria-pressed={revealed}
        >
          {revealed ? t(I18N.HIDE) : t(I18N.REVEAL)}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={copy}>
          {t(I18N.COPY)}
        </Button>
      </div>
      <p className="text-xs text-[var(--color-muted)]">
        {t(I18N.CLIPBOARD_RETENTION_WARNING)}
      </p>
      {copied && (
        <p role="status" className="text-xs">
          {t(I18N.CLIPBOARD_COPIED)}
        </p>
      )}
    </div>
  );
}

export function PassphraseField({
  value,
  onChange,
  id = "passphrase",
  showStrength = true,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
  showStrength?: boolean;
}) {
  const strength = estimatePassphraseStrength(value);
  const strengthKey =
    strength === "weak"
      ? I18N.PASSPHRASE_STRENGTH_WEAK
      : strength === "fair"
        ? I18N.PASSPHRASE_STRENGTH_FAIR
        : I18N.PASSPHRASE_STRENGTH_STRONG;
  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium" htmlFor={id}>
        {t(I18N.PASSPHRASE_LABEL)}
      </label>
      <Input
        id={id}
        type="password"
        autoComplete="new-password"
        minLength={PASSPHRASE_MIN_LENGTH}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t(I18N.PASSPHRASE_PLACEHOLDER)}
      />
      <p className="text-xs text-[var(--color-muted)]">{t(I18N.PASSPHRASE_MIN_HINT)}</p>
      {showStrength && value.length > 0 && (
        <p className="text-xs" data-testid="passphrase-strength">
          {t(strengthKey)}
        </p>
      )}
      <p className="text-xs text-[var(--color-muted)]">{t(I18N.OFFLINE_GUESS_NOTE)}</p>
    </div>
  );
}
