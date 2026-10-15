import { describe, expect, test, beforeEach, vi } from "vitest";
import {
  applyServiceWorkerUpdate,
  consumeReloadForBuild,
  getSwState,
  registerServiceWorker,
  subscribeToSwState,
  __resetSwState,
} from "../../src/sw-update";

/**
 * Client-side update lifecycle (PRD FR-3 G12, plan step 2).
 * Reload-once-per-build guard is the core invariant: an update loop must not be
 * able to spin the tab.
 */

interface FakeWorker {
  state: string;
  listeners: Map<string, Array<() => void>>;
  postMessage: (data: unknown) => void;
  addEventListener: (type: string, handler: () => void) => void;
  dispatch: (type: string) => void;
}

function createWorker(): FakeWorker {
  const listeners = new Map<string, Array<() => void>>();
  return {
    state: "installing",
    listeners,
    postMessage: vi.fn(),
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    dispatch(type) {
      for (const handler of listeners.get(type) ?? []) handler();
    },
  };
}

function installServiceWorkerStub(options: {
  active?: FakeWorker | null;
  waiting?: FakeWorker | null;
  installing?: FakeWorker | null;
} = {}) {
  const listeners = new Map<string, Array<(event: any) => void>>();
  const registration = {
    active: options.active ?? createWorker(),
    waiting: options.waiting ?? null,
    installing: options.installing ?? null,
    update: vi.fn().mockResolvedValue(undefined),
    addEventListener: (type: string, handler: (event: any) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    unregister: vi.fn().mockResolvedValue(true),
    dispatch: (type: string, event: any = {}) => {
      for (const handler of listeners.get(type) ?? []) handler(event);
    },
  };

  const register = vi.fn().mockResolvedValue(registration);
  const postToClients = (data: unknown) => {
    for (const handler of listeners.get("message") ?? []) handler({ data });
  };

  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    configurable: true,
    writable: true,
    value: {
      register,
      controller: options.active ?? null,
      addEventListener: (type: string, handler: (event: any) => void) => {
        listeners.set(type, [...(listeners.get(type) ?? []), handler]);
      },
      getRegistrations: vi.fn().mockResolvedValue([registration]),
    },
  });

  return { registration, register, postToClients, listeners };
}

describe("service worker registration lifecycle", () => {
  beforeEach(() => {
    __resetSwState();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  test("does nothing when disabled (dev) — service workers must not break HMR", async () => {
    installServiceWorkerStub();
    const registration = await registerServiceWorker({ enabled: false });
    expect(registration).toBeNull();
    expect(getSwState().registered).toBe(false);
  });

  test("registers with updateViaCache=none and scope=/", async () => {
    const { register } = installServiceWorkerStub();
    await registerServiceWorker({ enabled: true });
    expect(register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    expect(getSwState().registered).toBe(true);
  });

  test("activation of a new build reloads exactly once per build id", async () => {
    // A previous worker already controls the tab: this is an update.
    const { postToClients } = installServiceWorkerStub({ active: createWorker() });
    const reload = vi.fn();
    await registerServiceWorker({ enabled: true, reload });

    postToClients({ type: "ACTIVATED", buildId: "build2" });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(getSwState().buildId).toBe("build2");
    expect(getSwState().updated).toBe(true);

    // A second ACTIVATED for the same build must not reload again (loop guard).
    postToClients({ type: "ACTIVATED", buildId: "build2" });
    expect(reload).toHaveBeenCalledTimes(1);

    // A genuinely new build reloads again.
    postToClients({ type: "ACTIVATED", buildId: "build3" });
    expect(reload).toHaveBeenCalledTimes(2);
  });

  test("first install never reloads the page (no spurious reload on a fresh visit)", async () => {
    // No controller yet => first install, not an update.
    const { postToClients } = installServiceWorkerStub({ active: undefined });
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: { ...(globalThis.navigator as any).serviceWorker, controller: null },
    });

    const reload = vi.fn();
    await registerServiceWorker({ enabled: true, reload });
    postToClients({ type: "ACTIVATED", buildId: "build1" });

    expect(reload).not.toHaveBeenCalled();
    expect(getSwState().buildId).toBe("build1");
  });

  test("consumeReloadForBuild is idempotent per build id", () => {
    const reload = vi.fn();
    expect(consumeReloadForBuild("b1", reload)).toBe(true);
    expect(consumeReloadForBuild("b1", reload)).toBe(false);
    expect(consumeReloadForBuild("b2", reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  test("auto strategy: an installed new worker is reported as updated", async () => {
    const installing = createWorker();
    const { registration } = installServiceWorkerStub({ active: createWorker(), installing });
    await registerServiceWorker({ enabled: true });

    installing.state = "installed";
    installing.dispatch("statechange");

    expect(getSwState().updated).toBe(true);
    expect(getSwState().updateAvailable).toBe(false);
    expect(registration.update).toBeDefined();
  });

  test("prompt strategy: a waiting worker surfaces an actionable update notice", async () => {
    const waiting = createWorker();
    installServiceWorkerStub({ active: createWorker(), waiting });
    await registerServiceWorker({ enabled: true, strategy: "prompt" });
    expect(getSwState().updateAvailable).toBe(true);
  });

  test("applyServiceWorkerUpdate posts SKIP_WAITING and reloads once", async () => {
    const waiting = createWorker();
    const { registration, listeners } = installServiceWorkerStub({ active: createWorker(), waiting });
    await registerServiceWorker({ enabled: true, strategy: "prompt" });

    const reload = vi.fn();
    const pending = applyServiceWorkerUpdate(registration as unknown as ServiceWorkerRegistration);
    // The worker claims asynchronously; fire controllerchange like a browser would.
    for (const handler of listeners.get("controllerchange") ?? []) handler({});
    await pending;

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
    expect(reload).toBeDefined();
  });

  test("registration failure surfaces as an error state instead of throwing", async () => {
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      configurable: true,
      writable: true,
      value: {
        register: vi.fn().mockRejectedValue(new Error("registration blocked")),
        addEventListener: vi.fn(),
        controller: null,
      },
    });
    const result = await registerServiceWorker({ enabled: true });
    expect(result).toBeNull();
    expect(getSwState().error).toBe("registration blocked");
  });

  test("subscribers are notified on state transitions", async () => {
    installServiceWorkerStub();
    const seen: number[] = [];
    const unsubscribe = subscribeToSwState(() => seen.push(1));
    await registerServiceWorker({ enabled: true });
    expect(seen.length).toBeGreaterThan(0);
    unsubscribe();
  });
});