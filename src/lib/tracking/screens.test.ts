import { describe, expect, it } from "vitest";
import { nbaLeanScreen } from "./capture";
import type { GameLogPoint } from "@/lib/nba/propsMath";

const log = (points: number, season = 2026): GameLogPoint =>
  ({ date: "2026-11-01", opponent: "BOS", isHome: true, season, minutes: 32, points, rebounds: 5, assists: 4, threesMade: 2, steals: 1, blocks: 0, turnovers: 2 }) as GameLogPoint;

describe("the screener view frozen with an NBA lean", () => {
  it("records his windows at the line and side, and passes the tracked sets that fit", () => {
    // Newest first: under 20.5 in 5 of the last 5, 7 of 10.
    const logs = [12, 15, 18, 19, 20, 25, 26, 14, 16, 22].map((p) => log(p));
    const v = nbaLeanScreen({ stat: "points", side: "under", point: 20.5, chance: 0.58, priceAmerican: -120, minutes: 30 }, logs, 2026);
    expect(v.rates).toEqual({ l5: [5, 5], l10: [7, 10], l15: [7, 10], szn: [7, 10] });
    expect(v.screens).toEqual(["most-accurate-v1", "unders-base-v1"]);
  });

  it("drops out of a set on its price, side or minutes", () => {
    const logs = [12, 15, 18, 19, 20].map((p) => log(p));
    expect(nbaLeanScreen({ stat: "points", side: "under", point: 20.5, chance: 0.58, priceAmerican: -250, minutes: 30 }, logs, 2026).screens).toEqual([]);
    expect(nbaLeanScreen({ stat: "points", side: "under", point: 20.5, chance: 0.58, priceAmerican: -120, minutes: 20 }, logs, 2026).screens).toEqual([]);
    expect(nbaLeanScreen({ stat: "points", side: "over", point: 10.5, chance: 0.7, priceAmerican: -120, minutes: 30 }, logs, 2026).screens).toEqual([]);
  });

  it("records nothing for a stat it doesn't know", () => {
    expect(nbaLeanScreen({ stat: "nope", side: "under", point: 1.5, chance: 0.6, priceAmerican: -110 }, [], 2026)).toEqual({});
  });
});
