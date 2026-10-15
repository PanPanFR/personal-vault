import React from "react";
import { type SyncEngineStatus } from "../sync/types";

export interface SyncStatusProps {
  status: SyncEngineStatus;
  onRetry?: () => void;
  onResolveConflict?: () => void;
}

export function SyncStatus({ status, onRetry, onResolveConflict }: SyncStatusProps) {
  const { state, pendingCount, lastError, retryAfterSeconds } = status;

  let badgeColor = "bg-[var(--ctp-surface0)] text-[var(--color-muted)]";
  let statusText = "Ready";

  switch (state) {
    case "syncing":
      badgeColor = "bg-blue-500/10 text-blue-500 border-blue-500/20";
      statusText = "Syncing...";
      break;
    case "idle":
      if (pendingCount > 0) {
        badgeColor = "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
        statusText = `${pendingCount} pending upload`;
      } else {
        badgeColor = "bg-green-500/10 text-green-500 border-green-500/20";
        statusText = "Synced";
      }
      break;
    case "paused_quota":
      badgeColor = "bg-orange-500/10 text-orange-500 border-orange-500/20";
      statusText = "Sync paused (quota exhausted)";
      break;
    case "rate_limited":
      badgeColor = "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
      statusText = retryAfterSeconds
        ? `Rate limited (${retryAfterSeconds}s)`
        : "Rate limited";
      break;
    case "conflict":
      badgeColor = "bg-red-500/10 text-red-500 border-red-500/20";
      statusText = "Conflict detected";
      break;
    case "offline":
      badgeColor = "bg-[var(--ctp-surface0)] text-[var(--color-muted)]";
      statusText = "Offline";
      break;
    case "error":
      badgeColor = "bg-red-500/10 text-red-500 border-red-500/20";
      statusText = "Sync error";
      break;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--ctp-crust)] px-3 py-1.5 text-xs"
    >
      <span className="flex items-center gap-1.5">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            state === "idle" && pendingCount === 0
              ? "bg-green-500"
              : state === "syncing"
                ? "bg-blue-500 animate-pulse"
                : state === "conflict"
                  ? "bg-red-500"
                  : state === "paused_quota"
                    ? "bg-orange-500"
                    : "bg-yellow-500"
          }`}
        />
        <span className={`font-medium ${badgeColor}`}>{statusText}</span>
      </span>

      {state === "conflict" && onResolveConflict && (
        <button
          type="button"
          onClick={onResolveConflict}
          className="ml-auto rounded bg-red-500/20 px-2 py-0.5 text-xs font-semibold text-red-500 hover:bg-red-500/30"
        >
          Resolve
        </button>
      )}

      {(state === "error" || state === "paused_quota" || state === "rate_limited") && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="ml-auto rounded bg-[var(--ctp-surface1)] px-2 py-0.5 text-xs text-[var(--color-fg)] hover:bg-[var(--ctp-surface2)]"
        >
          Retry
        </button>
      )}
    </div>
  );
}
