/**
 * Platform detection for the PWA install + iOS ITP paths
 * (PRD §5 G11, pwa-operational §1.1/§2.3).
 *
 * Detection is intentionally conservative and testable: no feature sniffing of
 * private state, only public UA/platform/display-mode signals.
 */

export interface InstallState {
  /** Chromium fired `beforeinstallprompt` and we captured the deferred event. */
  canPrompt: boolean;
  /** Running as an installed/standalone app. */
  installed: boolean;
  /** iOS Safari: installable only through Share > Add to Home Screen. */
  needsManualIosInstall: boolean;
  kind: "chromium" | "safari" | "firefox" | "unknown";
}

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<(available: boolean) => void>();

export function isIOS(
  userAgent = navigator.userAgent,
  platform = navigator.platform ?? "",
  maxTouchPoints =
    typeof navigator !== "undefined" && typeof navigator.maxTouchPoints === "number"
      ? navigator.maxTouchPoints
      : 0,
): boolean {
  const ua = userAgent || "";
  const plat = platform || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ reports a desktop UA; touch points plus MacIntel give it away.
  if (/Macintosh/.test(ua) && maxTouchPoints > 1) return true;
  return /iPad|iPhone|iPod/.test(plat);
}

export function detectBrowserKind(userAgent = navigator.userAgent): InstallState["kind"] {
  const ua = userAgent || "";
  if (/CriOS|Chrome|Chromium|Edg\//.test(ua) && !/OPR\//.test(ua)) return "chromium";
  if (/OPR\//.test(ua)) return "chromium";
  if (/Firefox|FxiOS/.test(ua)) return "firefox";
  if (/Safari/.test(ua)) return "safari";
  return "unknown";
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return (
    typeof window.matchMedia === "function" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.matchMedia("(display-mode: minimal-ui)").matches)
  );
}

export function isIosBrowser(): boolean {
  return isIOS() && !isStandalone();
}

/**
 * Attach listeners for `beforeinstallprompt` + `appinstalled`.
 * Safe to call repeatedly; returns a cleanup function.
 */
export function watchInstallPrompt(): () => void {
  if (typeof window === "undefined") return () => undefined;

  const onPrompt = (event: Event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    for (const listener of promptListeners) listener(true);
  };
  const onInstalled = () => {
    deferredPrompt = null;
    for (const listener of promptListeners) listener(false);
  };

  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

export function subscribeToInstallAvailability(listener: (available: boolean) => void): () => void {
  promptListeners.add(listener);
  return () => promptListeners.delete(listener);
}

export function getInstallState(): InstallState {
  const ios = isIOS();
  const installed = isStandalone();
  return {
    canPrompt: deferredPrompt !== null,
    installed,
    needsManualIosInstall: ios && !installed,
    kind: detectBrowserKind(),
  };
}

/** Trigger the captured install prompt. Resolves false when nothing to show. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  if (choice.outcome === "accepted") deferredPrompt = null;
  return choice.outcome === "accepted";
}

/** Test seam. */
export function __setDeferredPrompt(event: BeforeInstallPromptEvent | null): void {
  deferredPrompt = event;
}

export function __resetPlatform(): void {
  deferredPrompt = null;
  promptListeners.clear();
}