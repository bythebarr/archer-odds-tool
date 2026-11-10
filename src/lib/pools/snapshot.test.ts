import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { chunkKey, chunkRows, isStale, CLAIM_TTL_MS, POOL_STALE_MS } = await import("./snapshot");

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
