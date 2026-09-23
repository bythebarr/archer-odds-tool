import { describe, it, expect } from "vitest";
import { buildTeamRatings, SHRINK_GAMES } from "./ratings";
import { HOME_FIELD_POINTS } from "./model";
import type { NflCompletedGame } from "./types";

let nextGameId = 1;
function game(
  overrides: Partial<NflCompletedGame> & Pick<NflCompletedGame, "homeTeamId" | "awayTeamId" | "homeScore" | "awayScore">
): NflCompletedGame {
  return {
    gameId: String(nextGameId++),
    startUtc: new Date("2026-09-13T17:00Z"),
    neutralSite: false,
    ...overrides,
  };
}

const ASOF = new Date("2027-02-01T00:00Z");

/** Deterministic shuffle (linear congruential generator) so a test failure is reproducible from its seed — same approach as CFB's ratings.test.ts. */
function shuffled<T>(arr: readonly T[], seed: number): T[] {
  const a = [...arr];
  let s = seed;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 9301 + 49297) % 233280;
    const j = Math.floor((s / 233280) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

describe("buildTeamRatings", () => {
  it("returns empty ratings for an empty schedule", () => {
    const { ratings, leagueAvgPoints } = buildTeamRatings([], ASOF);
    expect(ratings.size).toBe(0);
    expect(leagueAvgPoints).toBeGreaterThan(0);
  });

  it("enforces a strict as-of cutoff: a game AT the cutoff is excluded, not just games after it", () => {
    const cutoff = new Date("2026-09-19T15:30Z");
    const games = [game({ homeTeamId: "X", awayTeamId: "Y", homeScore: 30, awayScore: 10, startUtc: cutoff })];

    const atCutoff = buildTeamRatings(games, cutoff);
    expect(atCutoff.ratings.has("X")).toBe(false);

    const justAfter = buildTeamRatings(games, new Date(cutoff.getTime() + 1000));
    expect(justAfter.ratings.get("X")?.gamesPlayed).toBe(1);
  });

  it("never lets a target game leak into its own prediction's ratings", () => {
    const targetKickoff = new Date("2026-10-10T18:00Z");
    const games: NflCompletedGame[] = [
      game({ homeTeamId: "A", awayTeamId: "B", homeScore: 20, awayScore: 17, startUtc: new Date("2026-09-13T17:00Z") }),
      game({ homeTeamId: "A", awayTeamId: "B", homeScore: 45, awayScore: 3, startUtc: targetKickoff }),
    ];
    const { ratings } = buildTeamRatings(games, targetKickoff);
    expect(ratings.get("A")?.gamesPlayed).toBe(1);
    expect(ratings.get("B")?.gamesPlayed).toBe(1);
  });

  it("deduplicates by gameId — the same game appearing twice does not double-count", () => {
    const dup: NflCompletedGame = game({ homeTeamId: "A", awayTeamId: "B", homeScore: 30, awayScore: 10, gameId: "same-game" });
    const { ratings } = buildTeamRatings([dup, { ...dup }], ASOF);
    expect(ratings.get("A")!.gamesPlayed).toBe(1);
    expect(ratings.get("B")!.gamesPlayed).toBe(1);
  });

  it("strips home-field so a home win and an equivalent neutral-site (international) win rate the same", () => {
    // Q's game keeps the SAME total points as P's (so leagueAvgPoints is
    // unaffected by the swap) but shifts HOME_FIELD_POINTS/2 from the home
    // score to the away score, moving the margin by exactly HOME_FIELD_POINTS
    // — the same "move points between home/away, hold the total" construction
    // CFB's own equivalent test uses, generalized to a non-integer fitted HFA.
    const games: NflCompletedGame[] = [
      game({ homeTeamId: "P", awayTeamId: "FILLER", homeScore: 24, awayScore: 17, neutralSite: false }),
      game({
        homeTeamId: "Q",
        awayTeamId: "FILLER",
        homeScore: 24 - HOME_FIELD_POINTS / 2,
        awayScore: 17 + HOME_FIELD_POINTS / 2,
        neutralSite: true,
      }),
    ];
    const { ratings } = buildTeamRatings(games, ASOF);
    const p = ratings.get("P")!;
    const q = ratings.get("Q")!;
    expect(p.offenseRating).toBeCloseTo(q.offenseRating, 6);
    expect(p.defenseRating).toBeCloseTo(q.defenseRating, 6);
    expect(p.netRating).toBeCloseTo(q.netRating, 6);
  });

  it("opponent-adjusts: an equally-close win over a strong team rates above an equally-close win over a weak team", () => {
    const games: NflCompletedGame[] = [
      game({ homeTeamId: "STRONG", awayTeamId: "F1", homeScore: 45, awayScore: 10 }),
      game({ homeTeamId: "STRONG", awayTeamId: "F2", homeScore: 45, awayScore: 10 }),
      game({ homeTeamId: "F3", awayTeamId: "WEAK", homeScore: 45, awayScore: 10 }),
      game({ homeTeamId: "F4", awayTeamId: "WEAK", homeScore: 45, awayScore: 10 }),
      game({ homeTeamId: "A", awayTeamId: "STRONG", homeScore: 24, awayScore: 21 }),
      game({ homeTeamId: "B", awayTeamId: "WEAK", homeScore: 24, awayScore: 21 }),
    ];
    const { ratings } = buildTeamRatings(games, ASOF);
    expect(ratings.get("A")!.netRating).toBeGreaterThan(ratings.get("B")!.netRating);
    expect(ratings.get("STRONG")!.netRating).toBeGreaterThan(ratings.get("WEAK")!.netRating);
  });

  it("hand-checks offense/defense directionality: a team scoring far above average against an average opponent gets a positive offense rating, and a team allowing far above average gets a positive (worse) defense rating", () => {
    const games: NflCompletedGame[] = [
      game({ homeTeamId: "HIGH_OFFENSE", awayTeamId: "LOW_D", homeScore: 45, awayScore: 20 }),
      game({ homeTeamId: "LOW_D", awayTeamId: "ANCHOR1", homeScore: 22, awayScore: 22 }),
      game({ homeTeamId: "HIGH_OFFENSE", awayTeamId: "ANCHOR2", homeScore: 22, awayScore: 22 }),
      game({ homeTeamId: "ANCHOR1", awayTeamId: "ANCHOR2", homeScore: 22, awayScore: 22 }),
    ];
    const { ratings } = buildTeamRatings(games, ASOF);
    expect(ratings.get("HIGH_OFFENSE")!.offenseRating).toBeGreaterThan(0);
    expect(ratings.get("LOW_D")!.defenseRating).toBeGreaterThan(0);
  });

  it("shrinks early-season ratings toward zero by the documented gamesPlayed/(gamesPlayed+SHRINK_GAMES) factor", () => {
    const oneGame: NflCompletedGame[] = [game({ homeTeamId: "ONE", awayTeamId: "FILLER", homeScore: 40, awayScore: 15 })];
    const eightGames: NflCompletedGame[] = Array.from({ length: 8 }, () =>
      game({ homeTeamId: "EIGHT", awayTeamId: "FILLER", homeScore: 40, awayScore: 15 })
    );

    const oneRating = buildTeamRatings(oneGame, ASOF).ratings.get("ONE")!;
    const eightRating = buildTeamRatings(eightGames, ASOF).ratings.get("EIGHT")!;

    expect(oneRating.gamesPlayed).toBe(1);
    expect(eightRating.gamesPlayed).toBe(8);

    const oneShrink = 1 / (1 + SHRINK_GAMES);
    const eightShrink = 8 / (8 + SHRINK_GAMES);
    expect(eightRating.offenseRating / oneRating.offenseRating).toBeCloseTo(eightShrink / oneShrink, 6);
  });

  it("handles a team whose only opponent is a schedule dead end without exploding", () => {
    const games: NflCompletedGame[] = [game({ homeTeamId: "TEAM", awayTeamId: "ONLY_OPPONENT", homeScore: 38, awayScore: 6 })];
    const { ratings } = buildTeamRatings(games, ASOF);
    const team = ratings.get("TEAM")!;
    const opp = ratings.get("ONLY_OPPONENT")!;
    for (const r of [team, opp]) {
      expect(Number.isFinite(r.offenseRating)).toBe(true);
      expect(Number.isFinite(r.defenseRating)).toBe(true);
      expect(Number.isFinite(r.netRating)).toBe(true);
    }
    expect(team.gamesPlayed).toBe(1);
    expect(Math.abs(team.netRating)).toBeLessThan(30);
  });

  it("keeps disconnected schedule components independently centered rather than falsely comparable", () => {
    const pGames: NflCompletedGame[] = [
      game({ homeTeamId: "P1", awayTeamId: "P2", homeScore: 27, awayScore: 20 }),
      game({ homeTeamId: "P2", awayTeamId: "P3", homeScore: 24, awayScore: 23 }),
      game({ homeTeamId: "P3", awayTeamId: "P1", homeScore: 26, awayScore: 13 }),
    ];
    const qGames: NflCompletedGame[] = [
      game({ homeTeamId: "Q1", awayTeamId: "Q2", homeScore: 34, awayScore: 13 }),
      game({ homeTeamId: "Q2", awayTeamId: "Q3", homeScore: 31, awayScore: 10 }),
      game({ homeTeamId: "Q3", awayTeamId: "Q1", homeScore: 27, awayScore: 24 }),
    ];
    const { ratings } = buildTeamRatings([...pGames, ...qGames], ASOF);

    const pOffenseMean = (ratings.get("P1")!.offenseRating + ratings.get("P2")!.offenseRating + ratings.get("P3")!.offenseRating) / 3;
    const qOffenseMean = (ratings.get("Q1")!.offenseRating + ratings.get("Q2")!.offenseRating + ratings.get("Q3")!.offenseRating) / 3;
    expect(pOffenseMean).toBeCloseTo(0, 6);
    expect(qOffenseMean).toBeCloseTo(0, 6);

    const qGamesChanged: NflCompletedGame[] = [
      game({ homeTeamId: "Q1", awayTeamId: "Q2", homeScore: 48, awayScore: 3 }),
      game({ homeTeamId: "Q2", awayTeamId: "Q3", homeScore: 42, awayScore: 0 }),
      game({ homeTeamId: "Q3", awayTeamId: "Q1", homeScore: 38, awayScore: 6 }),
    ];
    const changed = buildTeamRatings([...pGames, ...qGamesChanged], ASOF).ratings;
    expect(changed.get("P1")!.offenseRating).toBeCloseTo(ratings.get("P1")!.offenseRating, 9);
    expect(changed.get("P2")!.offenseRating).toBeCloseTo(ratings.get("P2")!.offenseRating, 9);
    expect(changed.get("P3")!.offenseRating).toBeCloseTo(ratings.get("P3")!.offenseRating, 9);
  });

  it("produces materially the same ratings regardless of the input games' order (order independence)", () => {
    const games: NflCompletedGame[] = [
      game({ homeTeamId: "A", awayTeamId: "B", homeScore: 31, awayScore: 14 }),
      game({ homeTeamId: "A", awayTeamId: "C", homeScore: 24, awayScore: 20 }),
      game({ homeTeamId: "B", awayTeamId: "D", homeScore: 17, awayScore: 20 }),
      game({ homeTeamId: "C", awayTeamId: "D", homeScore: 27, awayScore: 17 }),
      game({ homeTeamId: "E", awayTeamId: "F", homeScore: 38, awayScore: 10 }),
      game({ homeTeamId: "E", awayTeamId: "G", homeScore: 21, awayScore: 20 }),
      game({ homeTeamId: "F", awayTeamId: "H", homeScore: 14, awayScore: 24 }),
      game({ homeTeamId: "G", awayTeamId: "H", homeScore: 20, awayScore: 20 }),
      game({ homeTeamId: "I", awayTeamId: "J", homeScore: 30, awayScore: 27 }),
      game({ homeTeamId: "I", awayTeamId: "A", homeScore: 10, awayScore: 34 }),
      game({ homeTeamId: "J", awayTeamId: "B", homeScore: 23, awayScore: 20 }),
      game({ homeTeamId: "C", awayTeamId: "E", homeScore: 17, awayScore: 17 }),
      game({ homeTeamId: "D", awayTeamId: "F", homeScore: 27, awayScore: 10 }),
      game({ homeTeamId: "G", awayTeamId: "I", homeScore: 14, awayScore: 21 }),
      game({ homeTeamId: "H", awayTeamId: "J", homeScore: 30, awayScore: 13 }),
      game({ homeTeamId: "A", awayTeamId: "D", homeScore: 20, awayScore: 17 }),
      game({ homeTeamId: "B", awayTeamId: "C", homeScore: 10, awayScore: 27 }),
      game({ homeTeamId: "E", awayTeamId: "H", homeScore: 24, awayScore: 14 }),
      game({ homeTeamId: "F", awayTeamId: "G", homeScore: 20, awayScore: 23 }),
      game({ homeTeamId: "I", awayTeamId: "B", homeScore: 27, awayScore: 24 }),
    ];

    const baseline = buildTeamRatings(games, ASOF).ratings;

    for (let seed = 1; seed <= 8; seed++) {
      const shuffledRatings = buildTeamRatings(shuffled(games, seed), ASOF).ratings;
      for (const [teamId, rating] of baseline) {
        const other = shuffledRatings.get(teamId)!;
        expect(other.netRating).toBeCloseTo(rating.netRating, 6);
        expect(other.offenseRating).toBeCloseTo(rating.offenseRating, 6);
        expect(other.defenseRating).toBeCloseTo(rating.defenseRating, 6);
      }
    }
  });

  it("converges: a much larger, densely-connected schedule still produces finite, bounded ratings (no divergence/oscillation)", () => {
    const games: NflCompletedGame[] = [];
    for (let i = 0; i < 60; i++) {
      const home = `T${i % 20}`;
      const away = `T${(i + 7) % 20}`;
      if (home === away) continue;
      games.push(
        game({
          homeTeamId: home,
          awayTeamId: away,
          homeScore: 14 + ((i * 11) % 28),
          awayScore: 9 + ((i * 5) % 24),
          startUtc: new Date(2026, 8, 1 + (i % 90)),
        })
      );
    }
    const { ratings } = buildTeamRatings(games, ASOF);
    for (const [, r] of ratings) {
      expect(Number.isFinite(r.netRating)).toBe(true);
      expect(Math.abs(r.netRating)).toBeLessThan(200);
    }
  });

  it("is deterministic for identical input", () => {
    const games: NflCompletedGame[] = [
      game({ homeTeamId: "A", awayTeamId: "B", homeScore: 24, awayScore: 17 }),
      game({ homeTeamId: "B", awayTeamId: "A", homeScore: 20, awayScore: 20, startUtc: new Date("2026-11-01T18:00Z") }),
    ];
    const r1 = buildTeamRatings(games, ASOF);
    const r2 = buildTeamRatings(games, ASOF);
    expect([...r1.ratings.entries()]).toEqual([...r2.ratings.entries()]);
    expect(r1.leagueAvgPoints).toBe(r2.leagueAvgPoints);
  });

  it("exposes strength-of-schedule as the average opponent net rating faced", () => {
    const games: NflCompletedGame[] = [
      game({ homeTeamId: "X", awayTeamId: "TOUGH", homeScore: 20, awayScore: 21 }),
      game({ homeTeamId: "TOUGH", awayTeamId: "F1", homeScore: 35, awayScore: 10 }),
      game({ homeTeamId: "TOUGH", awayTeamId: "F2", homeScore: 35, awayScore: 10 }),
    ];
    const { ratings } = buildTeamRatings(games, ASOF);
    expect(ratings.get("X")!.strengthOfSchedule).toBeCloseTo(ratings.get("TOUGH")!.netRating, 9);
  });

  it("handles a tie game (margin 0) without producing NaN/Infinity", () => {
    const games: NflCompletedGame[] = [game({ homeTeamId: "A", awayTeamId: "B", homeScore: 20, awayScore: 20 })];
    const { ratings } = buildTeamRatings(games, ASOF);
    expect(Number.isFinite(ratings.get("A")!.netRating)).toBe(true);
    expect(Number.isFinite(ratings.get("B")!.netRating)).toBe(true);
  });
});
