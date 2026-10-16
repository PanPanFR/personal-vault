/**
 * Clean start after storage eviction (PRD §5 G11, pwa-operational §2.4).
 *
 * Rendered INSTEAD of the vault when local storage was wiped while the app
 * shell survived. Never shows a partial vault, never throws: exactly the three
 * recovery routes from the spec, in order of least friction.
 */
import React from "react";
import { Button } from "./ui/Button";

export interface CleanStartProps {
  /** True when the previous run had a vault (eviction) vs a first launch. */
  wasEvicted: boolean;
  onRestoreFromKit?: () => void;
  onPairDevice?: () => void;
  onCreateVault?: () => void;
  onImportExport?: () => void;
}

export function CleanStart({
  wasEvicted,
  onRestoreFromKit,
  onPairDevice,
  onCreateVault,
  onImportExport,
}: CleanStartProps) {
  return (
    <main
      role="main"
      data-testid="clean-start"
      className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-6"
    >
      <h1 className="text-2xl font-bold">
        {wasEvicted ? "Local vault data was cleared" : "Welcome to Personal Vault"}
      </h1>
      <p className="text-sm text-[var(--color-muted)]">
        {wasEvicted ? (
          <>
            This browser no longer holds your local vault data (iOS clears it after ~7 days without
            an app visit, or storage was cleared manually). Nothing was corrupted — the encrypted
            copy in your cloud vault is untouched. Restore access with one of these:
          </>
        ) : (
          <>
            Set up a new encrypted vault, restore an existing one from a backup file, or pair this
            device with one you already use.
          </>
        )}
      </p>
      <div className="flex flex-col gap-2">
        <Button onClick={() => onRestoreFromKit?.()} variant="primary">
          Restore with Recovery Kit
        </Button>
        <Button onClick={() => onPairDevice?.()}>Pair with Existing Device</Button>
        {onImportExport && (
          <Button onClick={() => onImportExport?.()}>Import an encrypted export file</Button>
        )}
        <Button onClick={() => onCreateVault?.()}>Create New Vault</Button>
      </div>
      <p className="text-xs text-[var(--color-muted)]">
        Without an authorized device and valid recovery material, an encrypted vault cannot be
        opened — that is the security model, not a bug.
      </p>
    </main>
  );
}