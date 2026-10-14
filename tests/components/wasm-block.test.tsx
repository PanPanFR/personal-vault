import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { WasmBlock } from "../../src/components/WasmBlock";
import { WASM_FATAL_MESSAGE } from "../../src/crypto/wasm-guard";

describe("wasm fatal block", () => {
  test("renders full-screen fatal error, zero vault ops", () => {
    render(<WasmBlock />);
    const alert = screen.getByTestId("wasm-block");
    expect(alert).toHaveAttribute("role", "alert");
    expect(alert.textContent).toMatch(/cryptographic primitives/i);
    expect(WASM_FATAL_MESSAGE).toMatch(/cannot operate/i);
  });
});
