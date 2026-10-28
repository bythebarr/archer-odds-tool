import { describe, expect, it } from "vitest";
import { espnTennisCity, parseEspnTennisFixtures } from "./espnFixtures";

const comp = (id: string, round: string, state: string, home: string | null, away: string | null, extra: object = {}) => ({
  id,
  date: "2026-10-28T14:00Z",
  round: { displayName: round },
  status: { type: { state, completed: state === "post", name: state === "post" ? "STATUS_FINAL" : "STATUS_SCHEDULED" } },
  competitors: [
    { homeAway: "home", athlete: home ? { displayName: home } : null, linescores: [{ value: 6 }, { value: 7 }] },
    { homeAway: "away", athlete: away ? { displayName: away } : null, linescores: [{ value: 4 }, { value: 6 }] },
  ],
  ...extra,
});

const payload = {
  events: [
    {
      id: "23-2026",
      name: "Swiss Indoors Basel",
      venue: { displayName: "Basel, Switzerland" },
      groupings: [
        { grouping: { slug: "mens-singles" }, competitions: [comp("1", "Round 1", "pre", "Ugo Humbert", "Novak Djokovic"), comp("2", "Qualifying 1st Round", "pre", "A B", "C D"), comp("3", "Round 2", "pre", "TBD", "TBD"), comp("4", "Round 1", "post", "Jannik Sinner", "Alex Michelsen")] },
        { grouping: { slug: "mens-doubles" }, competitions: [comp("5", "Round 1", "pre", "X", "Y")] },
      ],
    },
  ],
};

describe("ESPN tennis fixtures", () => {
  it("keeps main-draw singles with both players named", () => {
    const f = parseEspnTennisFixtures(payload, "atp");
    expect(f.map((x) => x.competitionId)).toEqual(["1", "4"]);
    expect(f[0]).toMatchObject({ home: "Ugo Humbert", away: "Novak Djokovic", status: "scheduled", city: "basel", homeSets: null });
    expect(f[1]).toMatchObject({ status: "final", homeSets: 2, awaySets: 0 });
  });

  it("reads the city back from the league key", () => {
    expect(espnTennisCity("espn:atp:basel:23-2026")).toBe("basel");
    expect(espnTennisCity("tennis_atp_paris_masters")).toBeNull();
  });
});

describe("draw tour", () => {
  it("takes the tour from the draw, not the endpoint", async () => {
    const { drawTourOf } = await import("./espnResults");
    expect(drawTourOf("womens-singles", "atp")).toBe("wta");
    expect(drawTourOf("mens-singles", "wta")).toBe("atp");
    expect(drawTourOf(undefined, "wta")).toBe("wta");
  });
});
