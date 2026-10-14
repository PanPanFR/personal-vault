// @vitest-environment node
// Release probe (plan acceptance): 5,000-record open+search, p95 < 200 ms on
// reference hardware. CI runs the same shape; timing is logged so release
// hardware can compare. Generous CI bound (1 s) avoids flakes — the <200 ms
// target is asserted on reference hardware at release time.
import { describe, expect, test } from "vitest";
import { VaultSearch, toSearchable } from "../../src/search/vault-search";

function synthetic(i: number) {
  const types = ["note", "link", "snippet", "credential"] as const;
  return toSearchable(`rec-${i}`, {
    type: types[i % 4],
    title: `Record ${i} ${i % 7 === 0 ? "sodium crypto" : "general notes"}`,
    body: `Body text for record ${i} with keyword ${i % 11 === 0 ? "vault" : "item"} and filler lorem ipsum dolor sit amet.`,
    tags: [`tag${i % 50}`, i % 2 === 0 ? "even" : "odd"],
    is_favorite: i % 10 === 0,
    is_archived: i % 20 === 0,
    created_at: "2026-10-01T00:00:00.000Z",
    updated_at: "2026-10-02T00:00:00.000Z",
    schema_version: 1,
  });
}

describe("search performance probe (5k records)", () => {
  test("build + p95 search timing (logged)", () => {
    const vs = new VaultSearch();
    const docs = Array.from({ length: 5000 }, (_, i) => synthetic(i));
    const t0 = performance.now();
    vs.build(docs);
    const buildMs = performance.now() - t0;
    const queries = ["sodium", "tag:tag7", "type:note vault", "is:favorite", '"Record 42"'];
    const times: number[] = [];
    for (let r = 0; r < 3; r++) {
      for (const q of queries) {
        const s = performance.now();
        vs.search(q);
        times.push(performance.now() - s);
      }
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`[perf] build5000=${buildMs.toFixed(1)}ms avg=${avg.toFixed(2)}ms p95=${p95.toFixed(2)}ms`);
    expect(p95).toBeLessThan(1000); // CI bound; release target p95 < 200 ms
    vs.clear();
  }, 120000);
});
