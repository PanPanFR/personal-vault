/**
 * Service worker update notice (PRD FR-3 G12).
 *
 * AUTO strategy (plan default): the new worker claims clients immediately and we
 * surface an "app updated — reloaded" note. PROMPT strategy shows an actionable
 * button instead. Both read the same store, so switching strategies is a
 * one-line change in src/sw-update.ts.
 */
import React, { useSyncExternalStore } from "react";
import { getSwState, subscribeToSwState } from "../sw-update";

export function UpdateNotice() {
  const state = useSyncExternalStore(subscribeToSwState, getSwState, getSwState);

  if (!state.registered) return null;
  if (state.updateAvailable) {
    return (
      <div
        role="status"
        data-testid="sw-update-available"
        className="rounded-md border border-[var(--color-border)] bg-[var(--ctp-surface0)] px-3 py-2 text-xs"
      >
        {state.buildId ? `Update ready (build ${state.buildId}). ` : "Update ready. "}
        Reload to apply — your vault stays encrypted and intact during the swap.
      </div>
    );
  }
  if (state.updated) {
    return (
      <div
        role="status"
        data-testid="sw-updated"
        className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs"
      >
        App updated{state.buildId ? ` to build ${state.buildId}` : ""} — reloaded with the new version.
      </div>
    );
  }
  return null;
}