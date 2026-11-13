import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { chunkKey, chunkRows, isStale, oversizeChunks, cacheEntrySize, CHUNK_WARN_BYTES, CLAIM_TTL_MS, POOL_STALE_MS } = await import("./snapshot");

describe("chunkRows", () => {
  it("splits into fixed chunks, empty past the rows, dropping rows past the last chunk", () => {
    const rows = Array.from({ length: 7 }, (_, i) => i);
    expect(chunkRows(rows, 3, 4)).toEqual([[0, 1, 2], [3, 4, 5], [6], []]);
    expect(chunkRows(rows, 2, 2)).toEqual([[0, 1], [2, 3]]);
    expect(chunkRows([], 3, 2)).toEqual([[], []]);
  });

  it("names chunks under their pool", () => {
    expect(chunkKey("screener:nba", "main", 2)).toBe("screener:nba:main:2");
  });
});

describe("isStale", () => {
  const now = Date.parse("2026-11-10T23:00:00Z");
  const ago = (ms: number) => new Date(now - ms);

  it("a pool never built is stale", () => {
    expect(isStale(undefined, now)).toBe(true);
    expect(isStale({ builtAt: null, buildingSince: null }, now)).toBe(true);
  });

  it("fresh until POOL_STALE_MS, stale after", () => {
    expect(isStale({ builtAt: ago(POOL_STALE_MS - 1000), buildingSince: null }, now)).toBe(false);
    expect(isStale({ builtAt: ago(POOL_STALE_MS + 1000), buildingSince: null }, now)).toBe(true);
  });

  it("a live claim means a build is on its way: not asked for again", () => {
    expect(isStale({ builtAt: null, buildingSince: ago(10_000) }, now)).toBe(false);
    expect(isStale({ builtAt: ago(POOL_STALE_MS * 3), buildingSince: ago(CLAIM_TTL_MS - 1000) }, now)).toBe(false);
  });

  it("a claim older than its TTL belongs to a dead build: stale again", () => {
    expect(isStale({ builtAt: ago(POOL_STALE_MS * 3), buildingSince: ago(CLAIM_TTL_MS + 1000) }, now)).toBe(true);
  });
});

describe("oversizeChunks", () => {
  it("names each chunk too big for one read-cache entry", () => {
    const row = { text: "x".repeat(100) };
    const parts = { main: [Array(30).fill(row), Array(2).fill(row)], alt: [[]] };
    expect(oversizeChunks(parts, 3000)).toEqual(["main:0 0.00 MB"]);
    expect(oversizeChunks(parts)).toEqual([]);
  });
});

describe("chunk sizing", async () => {
  const { SCREENER_CHUNK_ROWS, SCREENER_CHUNKS } = await import("@/lib/screener/pool");
  it("keeps a screener chunk near 0.75 MB at today's ~750-byte rows, with the old 10,000-row reach", () => {
    expect(SCREENER_CHUNK_ROWS * 750).toBeLessThan(CHUNK_WARN_BYTES);
    expect(SCREENER_CHUNK_ROWS * SCREENER_CHUNKS).toBeGreaterThanOrEqual(10_000);
  });
});

describe("cacheEntrySize", () => {
  it("counts the rows' quotes twice, the way Next measures an unstable_cache entry", () => {
    const rows = [{ a: "b" }];
    expect(cacheEntrySize(rows)).toBeGreaterThan(JSON.stringify(rows).length + 4);
  });
});
