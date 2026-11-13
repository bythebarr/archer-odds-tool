import { describe, expect, it } from "vitest";
import { isPoolMetaKey, poolHealth } from "./status";

const now = new Date("2026-11-13T23:00:00Z").getTime();
const ago = (min: number) => new Date(now - min * 60_000);

describe("poolHealth", () => {
  it("reads only the meta rows, not the chunk rows", () => {
    expect(isPoolMetaKey("screener:nba")).toBe(true);
    expect(isPoolMetaKey("screener:nba:main:0")).toBe(false);
    const out = poolHealth(
      [
        { key: "screener:nba:main:0", builtAt: ago(1), buildingSince: null, error: null, rows: 2500 },
        { key: "screener:nba", builtAt: ago(4), buildingSince: null, error: null, rows: 3641 },
      ],
      now
    );
    expect(out).toEqual([{ pool: "screener:nba", builtAt: ago(4).toISOString(), ageMinutes: 4, rows: 3641, state: "fresh", claim: null, error: null }]);
  });

  it("says stale past the stale bar, with the age and the error that stopped the rebuild", () => {
    const [p] = poolHealth([{ key: "screener:nfl", builtAt: ago(19 * 60), buildingSince: null, error: "timeout exceeded when trying to connect", rows: 10 }], now);
    expect(p).toMatchObject({ state: "stale", ageMinutes: 1140, error: "timeout exceeded when trying to connect" });
  });

  it("marks a claim held past its TTL as abandoned, and a pool never built", () => {
    const [a, b] = poolHealth(
      [
        { key: "builder:all", builtAt: null, buildingSince: ago(1), error: null, rows: 0 },
        { key: "builder:nba", builtAt: ago(30), buildingSince: ago(5), error: null, rows: 1 },
      ],
      now
    );
    expect(a).toMatchObject({ pool: "builder:all", state: "never built", claim: { abandoned: false } });
    expect(b).toMatchObject({ pool: "builder:nba", state: "stale", claim: { abandoned: true } });
  });
});
