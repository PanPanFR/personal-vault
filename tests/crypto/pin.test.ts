import { describe, expect, test } from "vitest";
import pkg from "../../package.json";

describe("crypto dependency pins", () => {
  test("libsodium-wrappers-sumo pinned exact (no ^) for CSP", () => {
    const version = (pkg.dependencies as Record<string, string>)["libsodium-wrappers-sumo"];
    expect(version).toBe("0.7.15");
  });

  test("minisearch present (in-memory search)", () => {
    expect((pkg.dependencies as Record<string, string>).minisearch).toBeTruthy();
  });

  test("dexie present (ciphertext-only stores)", () => {
    expect((pkg.dependencies as Record<string, string>).dexie).toBeTruthy();
  });
});
