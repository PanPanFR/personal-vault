// Fatal full-screen block — rendered when WASM crypto cannot load.
// Zero vault ops permitted while this is shown (callers gate on the flag).
import React from "react";
import { I18N, t } from "../i18n";

export function WasmBlock({ message }: { message?: string }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--ctp-base)] p-6"
      data-testid="wasm-block"
    >
      <div className="max-w-md rounded-lg border border-[var(--color-error)] bg-[var(--color-card)] p-6 text-center">
        <h1 className="mb-2 text-xl font-bold">{t(I18N.WASM_FATAL_TITLE)}</h1>
        <p className="text-sm text-[var(--color-muted)]">
          {message ?? t(I18N.WASM_FATAL_DESC)}
        </p>
      </div>
    </div>
  );
}
