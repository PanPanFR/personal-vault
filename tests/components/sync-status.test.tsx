import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { SyncStatus } from "../../src/components/SyncStatus";

describe("SyncStatus UI component", () => {
  test("renders Synced state when idle with 0 pending", () => {
    render(
      <SyncStatus
        status={{
          state: "idle",
          pendingCount: 0,
          lastSyncTime: null,
          lastError: null,
        }}
      />,
    );
    expect(screen.getByText("Synced")).toBeInTheDocument();
  });

  test("renders pending count when idle with pending mutations", () => {
    render(
      <SyncStatus
        status={{
          state: "idle",
          pendingCount: 4,
          lastSyncTime: null,
          lastError: null,
        }}
      />,
    );
    expect(screen.getByText("4 pending upload")).toBeInTheDocument();
  });

  test("renders quota-exhausted state and triggers retry callback", () => {
    const onRetry = vi.fn();
    render(
      <SyncStatus
        status={{
          state: "paused_quota",
          pendingCount: 2,
          lastSyncTime: null,
          lastError: "Cloudflare free-tier quota exhausted. Cloud sync paused.",
        }}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText("Sync paused (quota exhausted)")).toBeInTheDocument();
    const retryBtn = screen.getByRole("button", { name: "Retry" });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  test("renders conflict state with resolve button and triggers callback", () => {
    const onResolve = vi.fn();
    render(
      <SyncStatus
        status={{
          state: "conflict",
          pendingCount: 1,
          lastSyncTime: null,
          lastError: "Conflict detected",
        }}
        onResolveConflict={onResolve}
      />,
    );

    expect(screen.getByText("Conflict detected")).toBeInTheDocument();
    const resolveBtn = screen.getByRole("button", { name: "Resolve" });
    fireEvent.click(resolveBtn);
    expect(onResolve).toHaveBeenCalledOnce();
  });
});
