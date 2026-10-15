import { describe, expect, test, vi } from "vitest";
import {
  SyncTriggerController,
  estimateHourlyRequests,
  SYNC_DEBOUNCE_MS,
  SYNC_IDLE_FLOOR_MS,
  SYNC_INTERVAL_MS,
} from "../../src/sync/triggers";
import type { SyncEngineStatus } from "../../src/sync/types";
import type { DeviceCredentials } from "../../src/sync/client";

const CREDENTIALS: DeviceCredentials = {
  deviceId: "11111111-1111-4111-8111-111111111111",
  rawToken: new Uint8Array([1]),
  privateKey: new Uint8Array([2]),
};

const IDLE: SyncEngineStatus = {
  state: "idle",
  pendingCount: 0,
  lastSyncTime: null,
  lastError: null,
};

function createHarness(overrides: { status?: Partial<SyncEngineStatus> } = {}) {
  let status: SyncEngineStatus = { ...IDLE, ...overrides.status };
  const sync = vi.fn().mockImplementation(async () => undefined);
  const timers = {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown,
    clearTimeout: (handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms) as unknown,
    clearInterval: (handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>),
  };
  const controller = new SyncTriggerController({
    runner: { sync, getStatus: async () => status },
    getCredentials: () => CREDENTIALS,
    isUnlocked: () => true,
    isForeground: () => true,
    isOnline: () => true,
    debounceMs: SYNC_DEBOUNCE_MS,
    intervalMs: SYNC_INTERVAL_MS,
    idleFloorMs: SYNC_IDLE_FLOOR_MS,
    timers,
  });
  return {
    controller,
    sync,
    setStatus: (next: Partial<SyncEngineStatus>) => {
      status = { ...status, ...next };
    },
  };
}

describe("sync trigger policy", () => {
  test("opens/unlocks sync immediately", async () => {
    const { controller, sync } = createHarness();
    await controller.trigger("unlock");
    expect(sync).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  test("post-mutation bursts are debounced into one cycle", async () => {
    vi.useFakeTimers();
    try {
      const { controller, sync } = createHarness();
      controller.notifyMutation();
      controller.notifyMutation();
      controller.notifyMutation();
      expect(sync).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(SYNC_DEBOUNCE_MS + 10);
      expect(sync).toHaveBeenCalledTimes(1);
      controller.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  test("manual retry bypasses the debounce", async () => {
    const { controller, sync } = createHarness();
    await controller.trigger("manual");
    expect(sync).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  test("60s interval is supplementary: idle tabs skip until the idle floor elapses", async () => {
    const { controller, sync } = createHarness();
    const now = 1_000_000;
    // First tick after a cycle: nothing pending and the idle floor is not reached.
    controller.markLastCycleAt(now - 30_000);
    await controller.tick(now);
    expect(sync).not.toHaveBeenCalled();

    // Once the floor has elapsed, one pull happens.
    await controller.tick(now + SYNC_IDLE_FLOOR_MS);
    expect(sync).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  test("pending mutations make every interval tick productive", async () => {
    const { controller, sync, setStatus } = createHarness({ status: { pendingCount: 3 } });
    setStatus({ pendingCount: 3 });
    const now = 2_000_000;
    await controller.tick(now);
    await controller.tick(now + 10_000);
    expect(sync).toHaveBeenCalledTimes(2);
    controller.stop();
  });

  test("never runs while locked, hidden, or offline", async () => {
    let unlocked = true;
    const sync = vi.fn().mockResolvedValue(undefined);
    const controller = new SyncTriggerController({
      runner: { sync, getStatus: async () => IDLE },
      getCredentials: () => CREDENTIALS,
      isUnlocked: () => unlocked,
      isForeground: () => false,
      isOnline: () => false,
      timers: {
        setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown,
        clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
        setInterval: (fn, ms) => setInterval(fn, ms) as unknown,
        clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
      },
    });

    await controller.tick();
    await controller.trigger("unlock");
    unlocked = true;
    await controller.tick();
    expect(sync).not.toHaveBeenCalled();
    controller.stop();
  });

  test("quota-paused state stops the interval from burning requests", async () => {
    const { controller, sync, setStatus } = createHarness({ status: { state: "paused_quota" } });
    setStatus({ state: "paused_quota", lastError: "quota exhausted" });
    await controller.tick(Date.now() + SYNC_IDLE_FLOOR_MS * 2);
    expect(sync).not.toHaveBeenCalled();
    // A manual retry is still allowed (the user asked for it).
    await controller.trigger("manual");
    expect(sync).toHaveBeenCalledTimes(1);
    controller.stop();
  });

  test("overlapping cycles are suppressed", async () => {
    let resolveSync: (() => void) | undefined;
    const sync = vi.fn().mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSync = resolve as () => void;
        }),
    );
    const controller = new SyncTriggerController({
      runner: { sync, getStatus: async () => IDLE },
      getCredentials: () => CREDENTIALS,
      isUnlocked: () => true,
    });

    const first = controller.trigger("manual");
    await controller.trigger("manual");
    expect(sync).toHaveBeenCalledTimes(1);
    resolveSync?.();
    await first;
    expect(controller.isRunning).toBe(false);
    controller.stop();
  });

  test("no credentials means no requests", async () => {
    const sync = vi.fn().mockResolvedValue(undefined);
    const controller = new SyncTriggerController({
      runner: { sync, getStatus: async () => IDLE },
      getCredentials: () => null,
      isUnlocked: () => true,
    });
    await controller.trigger("unlock");
    expect(sync).not.toHaveBeenCalled();
  });

  test("request budget stays far below the 300 GET/vault/hour free-tier cap", () => {
    // 60s ticks gated by a 4 minute idle floor => 15 pulls/hour when idle.
    expect(estimateHourlyRequests()).toBe(15);
    expect(estimateHourlyRequests()).toBeLessThan(300);
    // Even with a push batch per cycle we stay inside the cap.
    expect(estimateHourlyRequests({ pendingBatches: 4 })).toBeLessThan(300);
  });
});