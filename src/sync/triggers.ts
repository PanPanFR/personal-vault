/**
 * Sync trigger policy (plan/pwa-hardening-release.md step 5).
 *
 * Triggers, in priority order:
 *   1. open / unlock          -> immediate cycle
 *   2. post-mutation          -> debounced burst (coalesced, never a request storm)
 *   3. manual retry           -> immediate, bypasses debounce and idle skip
 *   4. 60 s foreground tick   -> SUPPLEMENTARY, not polling
 *
 * The interval only fires when there is work to do or when the idle floor has
 * elapsed (default 4 min), so an idle unlocked tab costs ~15 requests/hour —
 * comfortably inside the 300 GET/vault/hour free-tier limit.
 *
 * Nothing here reports "synced": state comes from the engine, which only reaches
 * idle after every mutation is acknowledged by the server.
 */
import type { DeviceCredentials } from "./client";
import type { SyncEngineStatus } from "./types";

export type SyncTriggerReason = "open" | "unlock" | "mutation" | "interval" | "manual" | "online";

export interface SyncRunner {
  sync(credentials: DeviceCredentials): Promise<void>;
  getStatus(): Promise<SyncEngineStatus>;
}

export interface SyncTriggerOptions {
  runner: SyncRunner;
  getCredentials: () => DeviceCredentials | null;
  isUnlocked: () => boolean;
  isForeground?: () => boolean;
  isOnline?: () => boolean;
  debounceMs?: number;
  intervalMs?: number;
  /** Idle floor: skip interval cycles that have nothing to do. */
  idleFloorMs?: number;
  onCycle?: (reason: SyncTriggerReason, status: SyncEngineStatus | null) => void;
  timers?: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
    setInterval: (fn: () => void, ms: number) => unknown;
    clearInterval: (handle: unknown) => void;
  };
}

export const SYNC_DEBOUNCE_MS = 2_000;
export const SYNC_INTERVAL_MS = 60_000;
export const SYNC_IDLE_FLOOR_MS = 4 * 60_000;

const defaultTimers = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
  clearInterval: (handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export class SyncTriggerController {
  private readonly runner: SyncRunner;
  private readonly getCredentials: () => DeviceCredentials | null;
  private readonly isUnlocked: () => boolean;
  private readonly isForeground: () => boolean;
  private readonly isOnline: () => boolean;
  private readonly onCycle?: (reason: SyncTriggerReason, status: SyncEngineStatus | null) => void;
  private readonly timers: NonNullable<SyncTriggerOptions["timers"]>;
  readonly debounceMs: number;
  readonly intervalMs: number;
  readonly idleFloorMs: number;

  private debounceHandle: unknown = null;
  private intervalHandle: unknown = null;
  private running = false;
  private inFlight = false;
  private lastCycleAt = 0;
  private started = false;

  constructor(options: SyncTriggerOptions) {
    this.runner = options.runner;
    this.getCredentials = options.getCredentials;
    this.isUnlocked = options.isUnlocked;
    this.isForeground = options.isForeground ?? (() => true);
    this.isOnline = options.isOnline ?? (() => (typeof navigator === "undefined" ? true : navigator.onLine));
    this.debounceMs = options.debounceMs ?? SYNC_DEBOUNCE_MS;
    this.intervalMs = options.intervalMs ?? SYNC_INTERVAL_MS;
    this.idleFloorMs = options.idleFloorMs ?? SYNC_IDLE_FLOOR_MS;
    this.onCycle = options.onCycle;
    this.timers = options.timers ?? defaultTimers;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.intervalHandle = this.timers.setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    this.started = false;
    if (this.intervalHandle !== null) {
      this.timers.clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    if (this.debounceHandle !== null) {
      this.timers.clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
  }

  /** Immediate cycle for open/unlock/manual/online; guarded against overlap. */
  async trigger(reason: SyncTriggerReason): Promise<void> {
    if (reason !== "manual" && reason !== "open" && reason !== "unlock" && reason !== "online") {
      return;
    }
    await this.runCycle(reason);
  }

  /** Coalesced burst: many quick mutations produce one cycle. */
  notifyMutation(): void {
    if (this.debounceHandle !== null) {
      this.timers.clearTimeout(this.debounceHandle);
    }
    this.debounceHandle = this.timers.setTimeout(() => {
      this.debounceHandle = null;
      void this.runCycle("mutation");
    }, this.debounceMs);
  }

  /** 60 s supplementary tick — never a poll while idle. */
  async tick(now: number = Date.now()): Promise<void> {
    if (this.inFlight) return;
    if (!this.isUnlocked()) return;
    if (!this.isForeground() || !this.isOnline()) return;

    const credentials = this.getCredentials();
    if (!credentials) return;

    const status = await this.runner.getStatus();
    if (status.state === "paused_quota") return;
    if (status.pendingCount === 0 && now - this.lastCycleAt < this.idleFloorMs) return;

    await this.runCycle("interval");
  }

  private async runCycle(reason: SyncTriggerReason): Promise<void> {
    if (this.inFlight) return;
    if (!this.isUnlocked()) return;
    const credentials = this.getCredentials();
    if (!credentials) return;
    if (!this.isOnline()) return;

    this.inFlight = true;
    try {
      await this.runner.sync(credentials);
      this.lastCycleAt = Date.now();
      this.onCycle?.(reason, await this.runner.getStatus());
    } catch {
      // The engine owns error classification (quota / rate limit / conflict).
    } finally {
      this.inFlight = false;
    }
  }

  /** Test seam + status readouts. */
  get isRunning(): boolean {
    return this.inFlight;
  }

  get lastCycleTimestamp(): number {
    return this.lastCycleAt;
  }

  /** Test seam: pretend the last cycle happened at `ts` (idle-floor math). */
  markLastCycleAt(ts: number): void {
    this.lastCycleAt = ts;
  }
}

/**
 * Request budget helper for the release runbook.
 * 60 s ticks with a 4 min idle floor => ~15 cycles/hour while idle, each cycle
 * costing at most one pull plus one push per non-empty outbox batch.
 */
export function estimateHourlyRequests(options: {
  intervalMs?: number;
  idleFloorMs?: number;
  pendingBatches?: number;
} = {}): number {
  const intervalMs = options.intervalMs ?? SYNC_INTERVAL_MS;
  const idleFloorMs = options.idleFloorMs ?? SYNC_IDLE_FLOOR_MS;
  const pulls = Math.max(1, Math.floor(3_600_000 / Math.max(intervalMs, idleFloorMs)));
  const batches = options.pendingBatches ?? 0;
  return pulls + pulls * batches;
}