import { describe, it, expect } from "vitest";
import { matchPropEventsToGames, resolveTeamName } from "./eventMatch";

/**
 * The fixtures here are real rows from ParlayAPI's MLB props feed on
 * 2026-07-21, not invented ones — the mis-parses ("Chicago Bulls" for the White
 * Sox), the truncations, the empty matchup and the duplicated event all came
 * off one pull. See eventMatch.ts for why matching on ids is impossible.
 */

const GAMES = [
  { id: "g-cubs", awayTeamName: "Detroit Tigers", homeTeamName: "Chicago Cubs" },
  { id: "g-rangers", awayTeamName: "Chicago White Sox", homeTeamName: "Texas Rangers" },
  { id: "g-brewers", awayTeamName: "New York Mets", homeTeamName: "Milwaukee Brewers" },
  { id: "g-cards", awayTeamName: "Los Angeles Dodgers", homeTeamName: "St. Louis Cardinals" },
  { id: "g-phillies", awayTeamName: "Los Angeles Dodgers", homeTeamName: "Philadelphia Phillies" },
];

const TEAMS = new Set(GAMES.flatMap((g) => [g.homeTeamName, g.awayTeamName]));

describe("resolveTeamName", () => {
  it("matches a clean name exactly", () => {
    expect(resolveTeamName("Detroit Tigers", TEAMS)).toBe("Detroit Tigers");
  });

  it("refuses a city that fields two teams that day", () => {
    // "Los Angeles" prefixes only the Dodgers here, but "New York" is genuinely
    // ambiguous across the slate — guessing would bind props to the wrong game.
    expect(resolveTeamName("New York", new Set(["New York Mets", "New York Yankees"]))).toBeNull();
  });

  it("recovers a wrong nickname from the right city", () => {
    // Their feed really does say "Chicago Bulls" in an MLB response. The city is
    // the only trustworthy token, and only one Chicago team is in this matchup.
    expect(resolveTeamName("Chicago Bulls", new Set(["Chicago White Sox", "Texas Rangers"]))).toBe(
      "Chicago White Sox"
    );
  });

  it("returns null for an empty side", () => {
    expect(resolveTeamName("", TEAMS)).toBeNull();
    expect(resolveTeamName(null, TEAMS)).toBeNull();
  });
});

describe("matchPropEventsToGames", () => {
  it("binds a clean matchup", () => {
    const { eventIdToGameId } = matchPropEventsToGames(
      [{ eventId: "e1", awayTeam: "Detroit Tigers", homeTeam: "Chicago Cubs" }],
      GAMES
    );
    expect(eventIdToGameId.get("e1")).toBe("g-cubs");
  });

  it("binds on ONE good side when the other is truncated", () => {
    // "Milwaukee Brewers @ New York" — the home side is unusable, but the
    // Brewers only play one game that day, so the matchup is still determined.
    const { eventIdToGameId } = matchPropEventsToGames(
      [{ eventId: "e2", awayTeam: "New York Mets", homeTeam: "Milwaukee" }],
      GAMES
    );
    expect(eventIdToGameId.get("e2")).toBe("g-brewers");
  });

  it("maps duplicate feed events onto the same game", () => {
    const { eventIdToGameId, unmatched } = matchPropEventsToGames(
      [
        { eventId: "dup-a", awayTeam: "Los Angeles Dodgers", homeTeam: "Philadelphia Phillies" },
        { eventId: "dup-b", awayTeam: "Los Angeles", homeTeam: "Philadelphia Phillies" },
      ],
      GAMES
    );
    expect(eventIdToGameId.get("dup-a")).toBe("g-phillies");
    expect(eventIdToGameId.get("dup-b")).toBe("g-phillies");
    expect(unmatched).toHaveLength(0);
  });

  it("refuses the empty matchup rather than guessing", () => {
    const { eventIdToGameId, unmatched } = matchPropEventsToGames(
      [{ eventId: "e3", awayTeam: " ", homeTeam: " " }],
      GAMES
    );
    expect(eventIdToGameId.size).toBe(0);
    expect(unmatched[0].reason).toBe("neither team resolved");
  });

  it("refuses a one-sided match when that team plays twice (doubleheader)", () => {
    // The Dodgers appear as the away team in two of these games, so a lone
    // "Los Angeles Dodgers" can't identify which — binding either would be a
    // coin flip on a graded record.
    const { eventIdToGameId, unmatched } = matchPropEventsToGames(
      [{ eventId: "e4", awayTeam: "Los Angeles Dodgers", homeTeam: "" }],
      GAMES
    );
    expect(eventIdToGameId.size).toBe(0);
    expect(unmatched[0].reason).toContain("ambiguous");
  });

  it("takes the earlier game when a confirmed matchup appears twice", () => {
    // Cardinals @ Angels showed up twice in one 24h window on the live feed.
    // Both teams are certain, so the only question is which game — and the book
    // is quoting the one about to start.
    const doubleheader = [
      {
        id: "g-late",
        awayTeamName: "St. Louis Cardinals",
        homeTeamName: "Los Angeles Angels",
        scheduledStartUtc: new Date("2026-07-22T02:10:00Z"),
      },
      {
        id: "g-early",
        awayTeamName: "St. Louis Cardinals",
        homeTeamName: "Los Angeles Angels",
        scheduledStartUtc: new Date("2026-07-21T23:05:00Z"),
      },
    ];
    const { eventIdToGameId, unmatched } = matchPropEventsToGames(
      [{ eventId: "e7", awayTeam: "St. Louis Cardinals", homeTeam: "Los Angeles Angels" }],
      doubleheader
    );
    expect(eventIdToGameId.get("e7")).toBe("g-early");
    expect(unmatched).toHaveLength(0);
  });

  it("refuses a matchup that isn't on the schedule", () => {
    const { unmatched } = matchPropEventsToGames(
      [{ eventId: "e5", awayTeam: "Detroit Tigers", homeTeam: "Texas Rangers" }],
      GAMES
    );
    expect(unmatched[0].reason).toBe("no scheduled game for those teams");
  });

  it("ignores orientation errors only when they'd be unambiguous", () => {
    // Home/away flipped: the pair exists but not in this orientation, so the
    // strict both-sides check fails rather than silently swapping them.
    const { unmatched } = matchPropEventsToGames(
      [{ eventId: "e6", awayTeam: "Chicago Cubs", homeTeam: "Detroit Tigers" }],
      GAMES
    );
    expect(unmatched[0].reason).toBe("no scheduled game for those teams");
  });
});
