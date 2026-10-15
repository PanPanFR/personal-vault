import React from "react";
import { type ConflictedItem } from "../sync/conflict-store";

export interface ConflictDialogProps {
  isOpen: boolean;
  conflict?: ConflictedItem;
  onKeepLocalAsNew: () => Promise<void>;
  onUseRemote: () => Promise<void>;
  onClose: () => void;
}

export function ConflictDialog({
  isOpen,
  conflict,
  onKeepLocalAsNew,
  onUseRemote,
  onClose,
}: ConflictDialogProps) {
  if (!isOpen || !conflict) return null;

  const isDeleteVsEdit = conflict.isServerTombstone && !conflict.isLocalTombstone;
  const isEditVsDelete = !conflict.isServerTombstone && conflict.isLocalTombstone;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--ctp-mantle)] p-6 shadow-xl">
        <h2
          id="conflict-dialog-title"
          className="text-lg font-semibold text-[var(--color-fg)]"
        >
          {isDeleteVsEdit
            ? "Remote Deletion Conflict"
            : isEditVsDelete
              ? "Local Deletion Conflict"
              : "Sync Revision Conflict"}
        </h2>

        <p className="mt-2 text-sm text-[var(--color-muted)]">
          {isDeleteVsEdit
            ? "This record was deleted on another device, but you edited it locally. Choose whether to preserve your local changes as a new item or accept the remote deletion."
            : isEditVsDelete
              ? "You deleted this record locally, but newer changes were made on another device."
              : "This record was updated concurrently on another device. Automatic overwrite is prohibited to protect your data."}
        </p>

        <div className="my-4 rounded-md border border-[var(--color-border)] bg-[var(--ctp-crust)] p-3 text-xs font-mono text-[var(--color-muted)]">
          <div>Record ID: {conflict.record_id}</div>
          <div>Local Revision: {conflict.localRevision}</div>
          <div>Server Revision: {conflict.serverRevision}</div>
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-fg)] hover:bg-[var(--ctp-surface0)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onUseRemote}
            className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/20"
          >
            {isDeleteVsEdit ? "Accept Remote Deletion" : "Use Remote Version"}
          </button>
          <button
            type="button"
            onClick={onKeepLocalAsNew}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Keep Local as New Item
          </button>
        </div>
      </div>
    </div>
  );
}
