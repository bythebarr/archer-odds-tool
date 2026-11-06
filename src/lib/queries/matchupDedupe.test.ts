import { describe, expect, it } from "vitest";
import { matchupKeepIds, type MatchupGameLike } from "./matchupDedupe";

const game = (id: string, over: Partial<MatchupGameLike> = {}): MatchupGameLike => ({
  id,
  homeTeamId: "cin",
  awayTeamId: "atl",
  // Sun Nov 8, 2026, 9:30am ET.
  scheduledStartUtc: new Date("2026-11-08T14:30:00Z"),
  freshestLineAt: 0,
  ...over,
});

describe("matchupKeepIds", () => {
  it("collapses a duplicate pair to the copy with the freshest lines", () => {
    const keep = matchupKeepIds([game("stale", { freshestLineAt: 100 }), game("fresh", { freshestLineAt: 200 })]);
    expect([...keep]).toEqual(["fresh"]);
  });

  it("keeps the only copy of a matchup", () => {
    expect([...matchupKeepIds([game("only")])]).toEqual(["only"]);
  });

  it("does not collapse the same teams on different ET dates", () => {
    const keep = matchupKeepIds([game("sun"), game("mon", { scheduledStartUtc: new Date("2026-11-09T14:30:00Z") })]);
    expect(keep.size).toBe(2);
  });

  it("does not collapse a reversed fixture (home/away swapped)", () => {
    const keep = matchupKeepIds([game("a"), game("b", { homeTeamId: "atl", awayTeamId: "cin" })]);
    expect(keep.size).toBe(2);
  });

  it("never collapses a row missing a team", () => {
    const keep = matchupKeepIds([game("a", { freshestLineAt: 500 }), game("b", { homeTeamId: null, freshestLineAt: 1 })]);
    expect(keep.size).toBe(2);
  });

  it("among three copies keeps exactly the freshest", () => {
    const keep = matchupKeepIds([game("x", { freshestLineAt: 5 }), game("y", { freshestLineAt: 50 }), game("z", { freshestLineAt: 10 })]);
    expect([...keep]).toEqual(["y"]);
  });
});
