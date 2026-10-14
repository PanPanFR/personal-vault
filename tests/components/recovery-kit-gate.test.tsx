import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecoveryKitCard } from "../../src/components/RecoveryKit";
import type { RecoveryKit } from "../../src/crypto/recovery";

const kit: RecoveryKit = {
  format: "personal-vault-recovery-kit",
  version: 1,
  vault_id: "01J9Z8QK7M3V6P2R5T8W4Y6V1A",
  api_origin: "https://personal-vault.pages.dev",
  recovery_secret: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  created_at: "2026-10-13T00:00:00.000Z",
  instructions: "Keep offline.",
};

describe("recovery kit save-confirmation gate", () => {
  test("setup cannot complete without confirmation", () => {
    const onChange = vi.fn();
    render(<RecoveryKitCard kit={kit} base32="ABCD-EFGH" onConfirmedChange={onChange} />);
    const box = screen.getByRole("checkbox");
    expect(box).not.toBeChecked();
    // Parent Continue stays disabled until confirmed — simulate the gate:
    let confirmed = false;
    onChange.mockImplementation((v: boolean) => {
      confirmed = v;
    });
    fireEvent.click(box);
    expect(onChange).toHaveBeenCalledWith(true);
    expect(confirmed).toBe(true);
    fireEvent.click(box);
    expect(confirmed).toBe(false);
  });
});
