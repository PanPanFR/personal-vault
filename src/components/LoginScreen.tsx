// Login screen — the one page in front of everything. One password field.
import { useState } from "react";
import { Button } from "./ui/Button";
import { Input } from "./ui/Input";
import { I18N, t } from "../i18n";
import { useAuth } from "../hooks/useAuth";

export function LoginScreen() {
  const { login } = useAuth();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ctp-base)] p-6"
      data-testid="login-screen"
    >
      <form
        className="w-full max-w-sm space-y-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-6"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const ok = await login(value);
            if (!ok) setError(t(I18N.LOGIN_WRONG));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="text-xl font-bold">{t(I18N.APP_NAME)}</h1>
        <p className="text-sm text-[var(--color-muted)]">{t(I18N.LOGIN_DESC)}</p>
        <label className="block text-sm font-medium" htmlFor="vault-password">
          {t(I18N.LOGIN_PASSWORD_LABEL)}
        </label>
        <Input
          id="vault-password"
          type="password"
          autoComplete="current-password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />
        {error && (
          <p role="alert" className="text-sm text-[var(--color-error)]">
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy || value.length === 0} className="w-full">
          {busy ? "…" : t(I18N.LOGIN_BUTTON)}
        </Button>
      </form>
    </div>
  );
}
