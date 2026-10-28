import { describe, expect, it } from "vitest";
import { mlbProjectedLine, mlbSplits, packMlbLog, priceMlbLine, roleLogs, unpackMlbLog, MLB_PROP_STAT_BY_KEY, type MlbChartLog } from "./propsSlate";

const bat = (date: string, hits: number, hand: "L" | "R" = "R"): MlbChartLog => ({
  date, opponent: "MIL", isHome: true, season: 2026, opposingStarterHand: hand,
  plateAppearances: 4, hits, totalBases: hits, homeRuns: 0, rbi: 0, runs: 0, baseOnBalls: 0, strikeoutsBatting: 1, stolenBases: 0,
  isStarter: null, outsRecorded: null, strikeoutsPitching: null, earnedRuns: null, hitsAllowed: null, walksAllowed: null,
});

describe("MLB props slate", () => {
  it("round-trips packed logs and keeps a role's games", () => {
    const l = bat("2026-10-25", 2);
    expect(unpackMlbLog(packMlbLog(l))).toEqual(l);
    expect(roleLogs([l, { ...l, plateAppearances: 0 }], "batter")).toHaveLength(1);
    expect(roleLogs([l], "pitcher")).toHaveLength(0);
  });

  it("puts ARCHR's line where Over is nearest even, and prices the ladder", () => {
    // over 0.5 = 0.8, over 1.5 = 0.45: 1.5 is nearest even
    const d = { kind: "pmf" as const, pmf: [0.2, 0.35, 0.3, 0.15] };
    expect(mlbProjectedLine(d, 1.1)).toBe(1.5);
    const low = priceMlbLine(d, [], 0.5);
    const high = priceMlbLine(d, [], 1.5);
    expect(low.probOver).toBeGreaterThan(high.probOver);
    expect(low.evOver).toBeNull();
    const withBooks = priceMlbLine(d, [
      { bookKey: "draftkings", bookName: "DraftKings", side: "over", point: 1.5, priceAmerican: 250 },
      { bookKey: "draftkings", bookName: "DraftKings", side: "under", point: 1.5, priceAmerican: -320 },
    ], 1.5);
    expect(withBooks.evOver).not.toBeNull();
  });

  it("splits by window, venue, opponent and the starter's hand", () => {
    const logs = [bat("2026-10-25", 2, "L"), bat("2026-10-24", 0), bat("2026-10-23", 1)];
    const splits = mlbSplits(logs, MLB_PROP_STAT_BY_KEY.get("hits")!, 0.5, "over", { season: 2026, venue: "home", opponent: "MIL", hand: "L" });
    expect(splits.find((s) => s.key === "l5")!.rate).toMatchObject({ hits: 2, sampleSize: 3 });
    expect(splits.find((s) => s.key === "hand")).toMatchObject({ label: "vs LHP", rate: { hits: 1, sampleSize: 1 } });
    expect(new Set(splits.map((s) => s.key)).size).toBe(splits.length);
  });
});
