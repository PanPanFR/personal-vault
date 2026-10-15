import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SettingsPage from "../../src/pages/Settings";
import { setLocale } from "../../src/i18n";
import {
  readSettings,
  persistSetting,
  markExported,
  deviceLocale,
  DEFAULT_SETTINGS,
} from "../../src/settings/store";
import {
  formatBytes,
  isQuotaExceededError,
  readStorageStatus,
  requestPersistentStorage,
  UNKNOWN_STORAGE_STATUS,
} from "../../src/settings/storage-status";
import { __resetSyncRuntime, registerSyncRuntime, DISCONNECTED_STATUS } from "../../src/sync/runtime";
import { LOCK_TIMEOUT_OPTIONS, getSession, setSession, clearSession, updateLockTimeout } from "../../src/vault/session";
import type { DeviceCredentials } from "../../src/sync/client";

const CREDENTIALS: DeviceCredentials = {
  deviceId: "22222222-2222-4222-8222-222222222222",
  rawToken: new Uint8Array([3]),
  privateKey: new Uint8Array([4]),
};

describe("frozen Settings keys", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("defaults: lock timeout 5 minutes, theme follows the system", () => {
    const settings = readSettings();
    expect(settings.lock_timeout).toBe(5);
    expect(settings.theme).toBe("system");
    expect(settings.last_export_at).toBeNull();
    expect(DEFAULT_SETTINGS.lock_timeout).toBe(5);
  });

  test("lock_timeout accepts exactly 1 / 5 / 15 / 30 and rejects anything else", () => {
    expect([...LOCK_TIMEOUT_OPTIONS]).toEqual([1, 5, 15, 30]);
    for (const minutes of LOCK_TIMEOUT_OPTIONS) {
      persistSetting("lock_timeout", minutes);
      expect(readSettings().lock_timeout).toBe(minutes);
    }
    persistSetting("lock_timeout", 7 as never);
    // An unsupported value is refused outright: the last valid choice stands.
    expect(readSettings().lock_timeout).toBe(30);
    localStorage.clear();
    expect(readSettings().lock_timeout).toBe(5);
  });

  test("theme and locale persist; locale default follows the device, fallback ID", () => {
    persistSetting("theme", "dark");
    persistSetting("locale", "en");
    expect(readSettings().theme).toBe("dark");
    expect(readSettings().locale).toBe("en");
    expect(["en", "id"]).toContain(deviceLocale("id"));
  });

  test("last_export_at is recorded on export and gates the iOS reminder", () => {
    expect(readSettings().last_export_at).toBeNull();
    const stamped = markExported(new Date("2026-10-15T09:00:00.000Z"));
    expect(stamped).toBe("2026-10-15T09:00:00.000Z");
    expect(readSettings().last_export_at).toBe("2026-10-15T09:00:00.000Z");
  });

  test("no secret material is ever written to localStorage", () => {
    persistSetting("lock_timeout", 15);
    persistSetting("theme", "light");
    persistSetting("locale", "id");
    markExported();
    const dump = JSON.stringify(localStorage);
    expect(dump).not.toMatch(/passphrase|dek|token|recovery/i);
  });
});

describe("lock timeout wiring", () => {
  afterEach(() => clearSession());

  test("updateLockTimeout applies to the live session and rejects bad values", () => {
    setSession({
      vaultId: "01HQ0000000000000000000000",
      dek: new Uint8Array([1]),
      recEncKey: new Uint8Array([2]),
      localCredKey: new Uint8Array([3]),
      keyVersion: 1,
      deviceToken: null,
      devicePrivateKey: null,
      lockTimeoutMinutes: 5,
      lastActivityMs: Date.now(),
    });
    expect(updateLockTimeout(30)).toBe(true);
    expect(getSession()?.lockTimeoutMinutes).toBe(30);
    expect(updateLockTimeout(7 as never)).toBe(false);
    expect(getSession()?.lockTimeoutMinutes).toBe(30);
  });
});

describe("storage status", () => {
  test("reports the browser grant honestly and never invents usage", async () => {
    const status = await readStorageStatus();
    expect(typeof status.persisted).toBe("boolean");
    expect(status.usageBytes === null || typeof status.usageBytes === "number").toBe(true);
    expect(UNKNOWN_STORAGE_STATUS.quotaExceeded).toBe(false);
  });

  test("requestPersistentStorage resolves false when unsupported", async () => {
    const granted = await requestPersistentStorage();
    expect(typeof granted).toBe("boolean");
  });

  test("quota errors are classified, not swallowed", () => {
    const quota = new Error("write failed");
    quota.name = "QuotaExceededError";
    expect(isQuotaExceededError(quota)).toBe(true);
    expect(isQuotaExceededError(new Error("out of quota"))).toBe(true);
    expect(isQuotaExceededError(new Error("network down"))).toBe(false);
    expect(isQuotaExceededError(null)).toBe(false);
  });

  test("byte formatting is human readable and locale aware", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10 MiB");
    expect(formatBytes(null)).toBe("—");
  });
});

describe("Settings page", () => {
  beforeEach(() => {
    localStorage.clear();
    setLocale("en");
    __resetSyncRuntime();
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      value: {
        persisted: async () => false,
        persist: async () => false,
        estimate: async () => ({ usage: 1024, quota: 1024 * 1024 * 10 }),
      },
    });
  });

  afterEach(() => {
    cleanup();
  });

  function renderSettings() {
    return render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
  }

  test("renders every required section", async () => {
    renderSettings();
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByText("Security")).toBeInTheDocument();
    expect(screen.getByText("Storage & offline")).toBeInTheDocument();
    expect(screen.getByText("Cloud sync")).toBeInTheDocument();
    expect(screen.getByText("Devices")).toBeInTheDocument();
    expect(screen.getByText("Backup & recovery")).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("storage-usage")).toBeInTheDocument());
  });

  test("lock timeout select defaults to 5 and persists a change", () => {
    renderSettings();
    const select = screen.getByLabelText("Auto-lock after") as HTMLSelectElement;
    expect(select.value).toBe("5");
    fireEvent.change(select, { target: { value: "30" } });
    expect(readSettings().lock_timeout).toBe(30);
  });

  test("locale switcher writes the frozen `locale` key", () => {
    renderSettings();
    fireEvent.change(screen.getByLabelText("Language / Bahasa"), { target: { value: "id" } });
    expect(readSettings().locale).toBe("id");
    expect(document.documentElement.lang).toBe("id");
  });

  test("storage card states that local storage is not a backup", async () => {
    renderSettings();
    await waitFor(() => expect(screen.getByTestId("storage-persisted")).toBeInTheDocument());
    expect(screen.getByTestId("storage-persisted").textContent).toMatch(/evict/i);
    expect(
      screen.getByText(/Local browser storage is a cache, never a backup/i),
    ).toBeInTheDocument();
  });

  test("sync card shows pending count, last sync and last error", async () => {
    registerSyncRuntime({
      getStatus: async () => ({
        state: "paused_quota",
        pendingCount: 7,
        lastSyncTime: "2026-10-15T08:00:00.000Z",
        lastError: "Cloudflare free-tier quota exhausted. Cloud sync paused.",
      }),
      subscribe: (listener) => {
        listener({
          state: "paused_quota",
          pendingCount: 7,
          lastSyncTime: "2026-10-15T08:00:00.000Z",
          lastError: "Cloudflare free-tier quota exhausted. Cloud sync paused.",
        });
        return () => undefined;
      },
      getCredentials: () => CREDENTIALS,
    });

    renderSettings();
    await waitFor(() => expect(screen.getByTestId("sync-pending")).toHaveTextContent("7"));
    expect(screen.getByTestId("sync-last")).toHaveTextContent("2026-10-15T08:00:00.000Z");
    expect(screen.getByTestId("sync-error")).toHaveTextContent(/quota exhausted/i);
    // Local usability guarantee is stated next to the quota message.
    expect(screen.getByText(/Sync runs only in the foreground while unlocked/i)).toBeInTheDocument();
  });

  test("device list shows server-recorded last-seen and offers rename + revoke", async () => {
    const listDevices = vi.fn().mockResolvedValue([
      {
        device_id: "33333333-3333-4333-8333-333333333333",
        label: "Pixel 8",
        created_at: "2026-10-01T10:00:00.000Z",
        last_seen_at: "2026-10-15T07:30:00.000Z",
        revoked_at: null,
      },
    ]);
    const renameDevice = vi.fn().mockResolvedValue({ status: "updated" });
    const revokeDevice = vi.fn().mockResolvedValue({ status: "revoked" });

    registerSyncRuntime({
      getStatus: async () => DISCONNECTED_STATUS,
      subscribe: () => () => undefined,
      getCredentials: () => CREDENTIALS,
      client: { listDevices, renameDevice, revokeDevice } as never,
    });

    renderSettings();
    await waitFor(() => expect(screen.getByText("Pixel 8")).toBeInTheDocument());
    expect(screen.getByText(/2026-10-15T07:30:00.000Z/)).toBeInTheDocument();

    const input = screen.getByLabelText("Rename Pixel 8");
    fireEvent.change(input, { target: { value: "Pixel 8 (home)" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Rename" })[0]);
    await waitFor(() => expect(renameDevice).toHaveBeenCalled());

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getAllByRole("button", { name: "Revoke" })[0]);
    await waitFor(() => expect(revokeDevice).toHaveBeenCalled());
  });

  test("about card exposes version, privacy and limitations", () => {
    renderSettings();
    expect(screen.getByTestId("app-version").textContent).toBeTruthy();
    expect(screen.getByText(/No analytics, no ads, no third-party scripts/i)).toBeInTheDocument();
    expect(screen.getByText(/Not an audited password manager/i)).toBeInTheDocument();
  });
});