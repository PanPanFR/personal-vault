/**
 * Sync runtime registry (plan/pwa-hardening-release.md step 5).
 *
 * A tiny observable seam so UI surfaces (AppLayout status pill, Settings sync
 * card) can read live engine state without importing the whole engine graph.
 * Nothing secret lives here: only the status object and a controller handle.
 */
import type { SyncEngineStatus } from "./types";
import type { SyncTriggerController } from "./triggers";
import type { SyncApiClient, DeviceCredentials } from "./client";

export interface SyncRuntime {
  getStatus(): Promise<SyncEngineStatus>;
  subscribe(listener: (status: SyncEngineStatus) => void): () => void;
  getCredentials(): DeviceCredentials | null;
  controller?: SyncTriggerController;
  client?: SyncApiClient;
}

export const DISCONNECTED_STATUS: SyncEngineStatus = {
  state: "offline",
  pendingCount: 0,
  lastSyncTime: null,
  lastError: null,
};

let runtime: SyncRuntime | null = null;

export function registerSyncRuntime(next: SyncRuntime): void {
  runtime = next;
}

export function getSyncRuntime(): SyncRuntime | null {
  return runtime;
}

export function getSyncStatusSnapshot(): SyncEngineStatus {
  return runtime ? lastKnownStatus : DISCONNECTED_STATUS;
}

export function __setSyncStatusSnapshot(status: SyncEngineStatus): void {
  lastKnownStatus = status;
}

/** Test seam: drop the registry entirely. */
export function __resetSyncRuntime(): void {
  runtime = null;
  lastKnownStatus = DISCONNECTED_STATUS;
}

let lastKnownStatus: SyncEngineStatus = DISCONNECTED_STATUS;