import { describe, it, expect } from "vitest";
import {
  validateTag,
  validateTags,
  validateUrl,
  sizeGuard,
} from "../../src/lib/validators";
import {
  TAG_MAX_PER_ITEM,
  TAG_MAX_LENGTH,
  PLAINTEXT_ITEM_CAP_BYTES,
} from "../../src/lib/limits";
import { tagsSchema, assertPlaintextSize } from "../../src/lib/schemas";

describe("tag validator (mirrors frozen tagsSchema)", () => {
  it("accepts a normal tag", () => {
    expect(validateTag("vault")).toBeNull();
  });

  it("rejects empty tags", () => {
    expect(validateTag("")).not.toBeNull();
    expect(validateTag("   ")).not.toBeNull();
  });

  it(`rejects tags longer than ${TAG_MAX_LENGTH} chars`, () => {
    expect(validateTag("x".repeat(TAG_MAX_LENGTH + 1))).not.toBeNull();
    expect(validateTag("x".repeat(TAG_MAX_LENGTH))).toBeNull();
  });

  it('rejects tags containing a double quote', () => {
    expect(validateTag('a"b')).not.toBeNull();
  });

  it("rejects tags with control characters", () => {
    expect(validateTag("a\tb")).not.toBeNull();
    expect(validateTag("a\nb")).not.toBeNull();
  });

  it(`rejects more than ${TAG_MAX_PER_ITEM} tags per item`, () => {
    const tags = Array.from({ length: TAG_MAX_PER_ITEM + 1 }, (_, i) => `t${i}`);
    expect(validateTags(tags)).not.toBeNull();
    expect(validateTags(tags.slice(0, TAG_MAX_PER_ITEM))).toBeNull();
  });

  it("rejects duplicate tags", () => {
    expect(validateTags(["a", "a"])).not.toBeNull();
  });

  it("agrees with the frozen Zod schema on boundaries", () => {
    expect(() => tagsSchema.parse(["ok"])).not.toThrow();
    expect(() =>
      tagsSchema.parse(Array.from({ length: 21 }, (_, i) => `t${i}`)),
    ).toThrow();
    expect(() => tagsSchema.parse(["x".repeat(65)])).toThrow();
    expect(() => tagsSchema.parse(['a"b'])).toThrow();
  });
});

describe("URL validation (no fetch)", () => {
  it("accepts http/https URLs", () => {
    expect(validateUrl("https://example.com/docs")).toBe(true);
    expect(validateUrl("http://localhost:3000/")).toBe(true);
  });

  it("rejects invalid URLs without fetching", () => {
    expect(validateUrl("not a url")).toBe(false);
    expect(validateUrl("ftp://example.com")).toBe(false);
    expect(validateUrl("javascript:alert(1)")).toBe(false);
    expect(validateUrl("")).toBe(false);
  });
});

describe("256 KiB size guard", () => {
  it("accepts small payloads", () => {
    expect(sizeGuard({ title: "hi" })).toBe(true);
  });

  it("rejects oversized fixture payloads", () => {
    const big = { body: "x".repeat(PLAINTEXT_ITEM_CAP_BYTES + 1) };
    expect(sizeGuard(big)).toBe(false);
    expect(() => assertPlaintextSize(big)).toThrow();
  });
});
