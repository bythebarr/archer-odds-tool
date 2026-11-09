import { describe, it, expect } from "vitest";
import { sportCardFor, type GameModelSport } from "./backtestGamesCards";

/**
 * The sport-card publication spec for `backtest-games` (see
 * backtestGamesCards.ts). The regression this guards: a game-model sport's
 * grade living only under `<sport>-games:ml`, where the trust gate never
 * reads — the NFL before Decision 8, the NBA before Phase 5. Both sports
 * must publish under their bare sport key.
 */
describe("sportCardFor", () => {
  it("publishes the NBA grade under the bare \"nba\" sport key", () => {
    expect(sportCardFor("nba").key).toBe("nba");
  });

  it("publishes the NFL grade under the bare \"nfl\" sport key", () => {
    expect(sportCardFor("nfl").key).toBe("nfl");
  });

  it("names the pricing model in the card label, for both sports", () => {
    for (const sport of ["nba", "nfl"] as GameModelSport[]) {
      const spec = sportCardFor(sport);
      expect(spec.label).toBe(`${sport.toUpperCase()} games — moneyline (points ratings, pricing)`);
      expect(spec.pricingModel).toBe("points-ratings");
    }
  });
});
