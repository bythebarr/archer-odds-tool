import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("next/server", () => ({ after: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

const { POOL_KEYS } = await import("./registry");
const { SCREENER_SPORTS } = await import("@/lib/screener/pool");
const { POOL_SOURCES } = await import("@/lib/builder/pool");

describe("pool registry", () => {
  it("has one pool per screener sport and per builder source, keyed as the readers read them", () => {
    expect(POOL_KEYS.sort()).toEqual([...SCREENER_SPORTS.map((s) => `screener:${s.key}`), ...POOL_SOURCES.map((s) => `builder:${s}`)].sort());
  });
});
