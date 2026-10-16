import { describe, expect, test, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { BackupBanner } from "../../src/components/BackupBanner";
import { CleanStart } from "../../src/components/CleanStart";
import { isIOS } from "../../src/pwa/platform";
import { detectStorageEviction, shouldShowCleanStart, clearVaultPresence, markVaultPresent } from "../../src/pwa/eviction";
import { createDb } from "../../src/db/dexie-schema";

describe("iOS export banner (PRD §5 G11)", () => {
  test("persists on iOS while no export exists and cannot be dismissed", () => {
    render(<BackupBanner isIos lastExportAt={null} />);
    const banner = screen.getByTestId("backup-banner");
    expect(banner).toHaveAttribute("data-variant", "ios-persistent");
    expect(banner).toHaveAttribute("aria-live", "assertive");
    expect(screen.getByRole("link", { name: /export now/i })).toHaveAttribute("href", "/settings");
    // No dismiss control before an export exists.
    expect(screen.queryByRole("button", { name: /^close$/i })).toBeNull();
  });

  test("reappears after remount until an export exists", () => {
    const { unmount } = render(<BackupBanner isIos lastExportAt={null} />);
    unmount();
    render(<BackupBanner isIos lastExportAt={null} />);
    expect(screen.getByTestId("backup-banner")).toBeInTheDocument();
  });

  test("retires once last_export_at is set", () => {
    render(<BackupBanner isIos lastExportAt="2026-10-15T10:00:00.000Z" />);
    expect(screen.queryByTestId("backup-banner")).toBeNull();
  });

  test("non-iOS surfaces only show the gentle Settings reminder", () => {
    render(<BackupBanner isIos={false} variant="settings" lastExportAt={null} />);
    expect(screen.getByTestId("backup-banner")).toHaveAttribute("data-variant", "gentle");
  });

  test("non-iOS dashboard stays quiet", () => {
    render(<BackupBanner isIos={false} variant="dashboard" lastExportAt={null} />);
    expect(screen.queryByTestId("backup-banner")).toBeNull();
  });

  test("export action fires the handler", () => {
    const onExport = vi.fn();
    render(<BackupBanner isIos lastExportAt={null} onExport={onExport} />);
    fireEvent.click(screen.getByRole("button", { name: /export now/i }));
    expect(onExport).toHaveBeenCalledOnce();
  });
});

describe("iOS detection", () => {
  test("recognises iPhone, iPad and iPadOS desktop UA", () => {
    expect(isIOS("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "iPhone", 5)).toBe(true);
    expect(isIOS("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", "iPad", 5)).toBe(true);
    // iPadOS 13+ lies about the UA; only touch points + MacIntel reveal it.
    expect(isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
    expect(isIOS("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
  });

  test("does not misfire on desktop Chromium", () => {
    expect(
      isIOS(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "Win32",
        0,
      ),
    ).toBe(false);
  });
});

describe("eviction -> clean start (no corrupt half-vault)", () => {
  test("intact storage does not trigger clean start", async () => {
    clearVaultPresence();
    const db = createDb("eviction-intact");
    await db.app_metadata.put({
      key: "vault",
      vault_id: "01HQ0000000000000000000000",
      schema_version: 1,
      crypto_format_version: 1,
    });
    const check = await detectStorageEviction(db);
    expect(check.state).toBe("intact");
    expect(shouldShowCleanStart(check)).toBe(false);
    db.close();
  });

  test("evicted storage with a prior vault offers pairing/recovery, not a half vault", async () => {
    markVaultPresent("01HQ0000000000000000000000");
    const db = createDb("eviction-empty");
    const check = await detectStorageEviction(db);
    expect(check.state).toBe("evicted");
    expect(check.hadVaultBefore).toBe(true);
    expect(shouldShowCleanStart(check)).toBe(true);
    db.close();
  });

  test("clean start lists all three recovery routes and the limitation", () => {
    render(
      <CleanStart
        wasEvicted
        onRestoreFromKit={() => undefined}
        onPairDevice={() => undefined}
        onCreateVault={() => undefined}
      />,
    );
    expect(screen.getByText("Restore with Recovery Kit")).toBeInTheDocument();
    expect(screen.getByText("Pair with Existing Device")).toBeInTheDocument();
    expect(screen.getByText("Create New Vault")).toBeInTheDocument();
    expect(screen.getByText(/security model, not a bug/i)).toBeInTheDocument();
  });

  test("clean start routes invoke their handlers", () => {
    const onRestoreFromKit = vi.fn();
    const onPairDevice = vi.fn();
    render(
      <CleanStart
        wasEvicted
        onRestoreFromKit={onRestoreFromKit}
        onPairDevice={onPairDevice}
      />,
    );
    fireEvent.click(screen.getByText("Restore with Recovery Kit"));
    fireEvent.click(screen.getByText("Pair with Existing Device"));
    expect(onRestoreFromKit).toHaveBeenCalledOnce();
    expect(onPairDevice).toHaveBeenCalledOnce();
  });

  test("first launch is onboarding, not an eviction incident", () => {
    clearVaultPresence();
    render(<CleanStart wasEvicted={false} />);
    expect(screen.getByText("Welcome to Personal Vault")).toBeInTheDocument();
  });
});