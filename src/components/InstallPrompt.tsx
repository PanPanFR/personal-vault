/**
 * Install guidance + browser fallback (PRD §5, pwa-operational §1.1).
 *
 * Chromium gets the native install prompt. iOS Safari gets the manual
 * Share > Add to Home Screen recipe. Everything else keeps the app fully usable
 * in a plain browser tab — install is never a gate.
 */
import React, { useEffect, useState } from "react";
import {
  getInstallState,
  isStandalone,
  promptInstall,
  subscribeToInstallAvailability,
  watchInstallPrompt,
} from "../pwa/platform";

export function InstallPrompt({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState(getInstallState);
  const [installedNow, setInstalledNow] = useState(isStandalone);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const stopWatching = watchInstallPrompt();
    const unsubscribe = subscribeToInstallAvailability(() => {
      setState(getInstallState());
      setInstalledNow(isStandalone());
    });
    return () => {
      stopWatching();
      unsubscribe();
    };
  }, []);

  if (dismissed || installedNow) return null;

  const canPrompt = state.canPrompt;
  const show = canPrompt || state.needsManualIosInstall || compact;

  if (!show) return null;

  return (
    <aside
      role="region"
      aria-label="Install Personal Vault"
      data-testid="install-prompt"
      className="mb-4 rounded-lg border border-[var(--color-border)] bg-[var(--ctp-surface0)] p-3 text-sm"
    >
      <p className="font-semibold">Install Personal Vault</p>
      {canPrompt && (
        <>
          <p className="mt-1 text-xs text-[var(--color-muted)]">
            Run it in its own window and keep the encrypted vault one tap away. The app stays fully
            usable in this browser tab either way.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void promptInstall()}
              className="rounded bg-[var(--ctp-surface2)] px-2.5 py-1 text-xs font-semibold"
            >
              Install
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="rounded px-2 py-1 text-xs underline"
            >
              Not now
            </button>
          </div>
        </>
      )}
      {!canPrompt && state.needsManualIosInstall && (
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          On iPhone/iPad: tap <strong>Share</strong> → <strong>Add to Home Screen</strong>. Until
          then, everything works in Safari — but iOS may clear local data after ~7 days without an
          app visit, so export a backup regularly.
        </p>
      )}
      {!canPrompt && !state.needsManualIosInstall && (
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          No install prompt here — keep using the browser tab; all features work, only offline
          relaunch needs an installed app.
        </p>
      )}
    </aside>
  );
}