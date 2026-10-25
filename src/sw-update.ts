/**
 * Client-side service worker lifecycle (plan/pwa-hardening-release.md step 2).
 *
 * Activation strategy default: AUTO — a newly installed worker claims clients
 * immediately and the app shows a "reloaded" notice. `prompt` mode is kept
 * switchable so the decision stays reversible without a code change.
 *
 * Reloading is guarded per build id so an update loop (SW activating itself over
 * and over) can never spin the tab. This is the stale-shell hazard from
 * PRD FR-3 G12: the shell must never keep running against a newer API.
 */

export type SwUpdateStrategy = "auto" | "prompt";

export const DEFAULT_SW_UPDATE_STRATEGY: SwUpdateStrategy = "auto";
export const SW_URL = "/sw.js";
const RELOADED_FOR_KEY = "pv-sw-reloaded-for";

export interface SwState {
  supported: boolean;
  registered: boolean;
  /** A new worker is installed and waiting (prompt mode only). */
  updateAvailable: boolean;
  /** A new worker activated in this session. */
  updated: boolean;
  buildId: string | null;
  error: string | null;
}

const state: SwState = {
  supported: false,
  registered: false,
  updateAvailable: false,
  updated: false,
  buildId: null,
  error: null,
};

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeToSwState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSwState(): SwState {
  return state;
}

/** Test seam: reset module state between specs. */
export function __resetSwState(): void {
  state.supported = false;
  state.registered = false;
  state.updateAvailable = false;
  state.updated = false;
  state.buildId = null;
  state.error = null;
}

export function isServiceWorkerSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator;
}

function readReloadedFor(): string | null {
  try {
    return sessionStorage.getItem(RELOADED_FOR_KEY);
  } catch {
    return null;
  }
}

/**
 * Reload at most once per activated build. Returns true when a reload happened,
 * which lets specs assert the guard without stubbing location.
 */
export function consumeReloadForBuild(buildId: string, reload: () => void = () => location.reload()): boolean {
  if (!buildId || readReloadedFor() === buildId) return false;
  try {
    sessionStorage.setItem(RELOADED_FOR_KEY, buildId);
  } catch {
    // Private mode: reload is still safe, we just lose the loop guard.
  }
  reload();
  return true;
}

function trackInstallingWorker(worker: ServiceWorker | null, strategy: SwUpdateStrategy): void {
  if (!worker) return;
  worker.addEventListener("statechange", () => {
    if (worker.state === "installed") {
      if (navigator.serviceWorker.controller) {
        // A previous worker controls this page: this is an UPDATE.
        state.updated = true;
        state.updateAvailable = strategy === "prompt";
        emit();
      }
    }
  });
}

/**
 * Register + wire the update lifecycle.
 *
 * `updateViaCache: "none"` is mandatory: a HTTP-cached sw.js means an old worker
 * can be re-installed forever. Registration is skipped in dev (service workers
 * make HMR unusable) and wherever the API is unavailable.
 */
export async function registerServiceWorker(options: {
  enabled?: boolean;
  strategy?: SwUpdateStrategy;
  url?: string;
  reload?: () => void;
} = {}): Promise<ServiceWorkerRegistration | null> {
  const strategy = options.strategy ?? DEFAULT_SW_UPDATE_STRATEGY;
  const enabled = options.enabled ?? import.meta.env?.PROD ?? false;
  const reload = options.reload ?? (() => location.reload());

  if (!enabled || !isServiceWorkerSupported()) return null;

  state.supported = true;

  const navigatorRef = navigator;
  // First install must NOT reload the page: only an UPDATE of an already
  // controlled tab may take the reload-once path.
  const hadController = Boolean(navigatorRef.serviceWorker.controller);

  navigatorRef.serviceWorker.addEventListener("message", (event) => {
    const data = (event as MessageEvent).data as { type?: string; buildId?: string } | null;
    if (!data || typeof data.type !== "string") return;
    if (data.type === "ACTIVATED" && data.buildId) {
      state.buildId = data.buildId;
      // Activation while a previous worker was controlling this tab IS an update,
      // even if the `installed` statechange was missed.
      if (hadController) state.updated = true;
      state.updateAvailable = false;
      emit();
      if (hadController) consumeReloadForBuild(data.buildId, reload);
    }
    if (data.type === "VERSION" && data.buildId) {
      state.buildId = data.buildId;
      emit();
    }
  });

  try {
    const registration = await navigatorRef.serviceWorker.register(
      options.url ?? SW_URL,
      { scope: "/", updateViaCache: "none" },
    );
    state.registered = true;
    emit();

    if (registration.waiting && strategy === "prompt") {
      state.updateAvailable = true;
      emit();
    }
    if (registration.active) {
      trackInstallingWorker(registration.installing, strategy);
      registration.active.postMessage({ type: "GET_VERSION" });
    }
    registration.addEventListener("updatefound", () => {
      trackInstallingWorker(registration.installing, strategy);
    });
    return registration;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    emit();
    return null;
  }
}

/** Prompt-mode activation: ask the WAITING worker to take over, then reload once. */
export async function applyServiceWorkerUpdate(
  registration: ServiceWorkerRegistration | null,
  reload: () => void = () => location.reload(),
): Promise<void> {
  // Only ever message the waiting worker: the active one already controls us and
  // SKIP_WAITING would be a no-op round trip.
  const waiting = registration?.waiting ?? null;
  if (!waiting) return;
  await new Promise<void>((resolve) => {
    // Hard timeout: a controller that never claims must not freeze the button.
    const guard = setTimeout(() => resolve(), 3000);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        clearTimeout(guard);
        resolve();
      },
      { once: true },
    );
    waiting.postMessage({ type: "SKIP_WAITING" });
  });
  consumeReloadForBuild(state.buildId ?? "manual", reload);
}

/** Eviction/reset helper: drop every worker + cache (clean-start tooling + specs). */
export async function unregisterServiceWorkers(): Promise<boolean> {
  if (!isServiceWorkerSupported()) return false;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if (typeof caches !== "undefined") {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  return true;
}