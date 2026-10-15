import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { ConflictDialog } from "../../src/components/ConflictDialog";
import { type ConflictedItem } from "../../src/sync/conflict-store";

describe("ConflictDialog UI component", () => {
  const sampleConflict: ConflictedItem = {
    record_id: "test-record-uuid-1234",
    localRevision: 1,
    serverRevision: 2,
    localCiphertext: "local_ct",
    localNonce: "local_nonce",
    serverCiphertext: "server_ct",
    serverNonce: "server_nonce",
    isServerTombstone: false,
    isLocalTombstone: false,
    schemaVersion: 1,
    keyVersion: 1,
  };

  test("renders conflict details and handles Keep Local as New Item", async () => {
    const onKeepLocal = vi.fn().mockResolvedValue(undefined);
    const onUseRemote = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <ConflictDialog
        isOpen={true}
        conflict={sampleConflict}
        onKeepLocalAsNew={onKeepLocal}
        onUseRemote={onUseRemote}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("Sync Revision Conflict")).toBeInTheDocument();
    expect(screen.getByText(/test-record-uuid-1234/)).toBeInTheDocument();

    const keepBtn = screen.getByRole("button", { name: "Keep Local as New Item" });
    fireEvent.click(keepBtn);
    expect(onKeepLocal).toHaveBeenCalledOnce();
  });

  test("renders delete-vs-edit condition with special messaging", () => {
    const deleteConflict: ConflictedItem = {
      ...sampleConflict,
      isServerTombstone: true,
      serverCiphertext: null,
      serverNonce: null,
    };

    render(
      <ConflictDialog
        isOpen={true}
        conflict={deleteConflict}
        onKeepLocalAsNew={vi.fn()}
        onUseRemote={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText("Remote Deletion Conflict")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept Remote Deletion" })).toBeInTheDocument();
  });
});
