import { describe, it, expect } from "vitest";
import { buildTeamRatings, SHRINK_GAMES } from "./ratings";
import type { CfbCompletedGame } from "./types";

let nextEventId = 1;
function game(
  overrides: Partial<CfbCompletedGame> & Pick<CfbCompletedGame, "homeTeamId" | "awayTeamId" | "homeScore" | "awayScore">
): CfbCompletedGame {
  return {
    espnEventId: String(nextEventId++),
    startUtc: new Date("2026-09-05T17:00Z"),
    neutralSite: false,
    ...overrides,
  };
}

const ASOF = new Date("2026-12-01T00:00Z");

/** Deterministic shuffle (linear congruential generator) so a test failure is reproducible from its seed. */
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
    expect(leagueAvgPoints).toBeGreaterThan(0); // falls back to the documented default
  });

  it("enforces a strict as-of cutoff: a game AT the cutoff is excluded, not just games after it", () => {
    const cutoff = new Date("2026-09-19T15:30Z");
    const games = [game({ homeTeamId: "X", awayTeamId: "Y", homeScore: 50, awayScore: 0, startUtc: cutoff })];

    const atCutoff = buildTeamRatings(games, cutoff);
    expect(atCutoff.ratings.has("X")).toBe(false);

    const justAfter = buildTeamRatings(games, new Date(cutoff.getTime() + 1000));
    expect(justAfter.ratings.get("X")?.gamesPlayed).toBe(1);
  });

  it("never lets a target game leak into its own prediction's ratings", () => {
    const targetKickoff = new Date("2026-10-10T18:00Z");
    const games: CfbCompletedGame[] = [
      game({ homeTeamId: "A", awayTeamId: "B", homeScore: 20, awayScore: 17, startUtc: new Date("2026-09-05T17:00Z") }),
      // The "target" game — same two teams meeting again, but AFTER the prediction's own kickoff.
      game({ homeTeamId: "A", awayTeamId: "B", homeScore: 45, awayScore: 3, startUtc: targetKickoff }),
    ];
    const { ratings } = buildTeamRatings(games, targetKickoff);
    // Only the September meeting should count — one game each, not two.
    expect(ratings.get("A")?.gamesPlayed).toBe(1);
    expect(ratings.get("B")?.gamesPlayed).toBe(1);
  });

  it("excludes a live/in-progress game the same as a future one — only completed games ever reach ratings", () => {
    // buildTeamRatings only ever receives CfbCompletedGame values (toCompletedGames
    // already filters to status === "final" upstream — see espnScoreboard.test.ts),
    // so the only leakage vector left here is the as-of cutoff itself, re-verified.
    const inProgressKickoff = new Date("2026-09-19T12:00Z");
    const games: CfbCompletedGame[] = [game({ homeTeamId: "A", awayTeamId: "B", homeScore: 3, awayScore: 0, startUtc: inProgressKickoff })];
    const { ratings } = buildTeamRatings(games, inProgressKickoff); // predicting the game itself, as it's kicking off
    expect(ratings.has("A")).toBe(false);
  });

  it("deduplicates by ESPN event id — the same event appearing twice does not double-count", () => {
    const dup: CfbCompletedGame = game({ homeTeamId: "A", awayTeamId: "B", homeScore: 30, awayScore: 10, espnEventId: "same-event" });
    const { ratings } = buildTeamRatings([dup, { ...dup }], ASOF);
    expect(ratings.get("A")!.gamesPlayed).toBe(1);
    expect(ratings.get("B")!.gamesPlayed).toBe(1);
  });

  it("strips home-field so a home win and an equivalent neutral-site win rate the same", () => {
    const games: CfbCompletedGame[] = [
      // P wins at home 31-21 (raw margin 10).
      game({ homeTeamId: "P", awayTeamId: "FILLER", homeScore: 31, awayScore: 21, neutralSite: false }),
      // Q wins the same underlying game at a neutral site, 30-22 (raw margin 8 — the home-field points already removed from the raw score).
      game({ homeTeamId: "Q", awayTeamId: "FILLER", homeScore: 30, awayScore: 22, neutralSite: true }),
    ];
    const { ratings } = buildTeamRatings(games, ASOF);
    const p = ratings.get("P")!;
    const q = ratings.get("Q")!;
    expect(p.offenseRating).toBeCloseTo(q.offenseRating, 6);
    expect(p.defenseRating).toBeCloseTo(q.defenseRating, 6);
    expect(p.netRating).toBeCloseTo(q.netRating, 6);
  });

  it("opponent-adjusts: an equally-close win over a strong team rates above an equally-close win over a weak team", () => {
    const games: CfbCompletedGame[] = [
      // Establish STRONG as strong and WEAK as weak against neutral fillers.
      game({ homeTeamId: "STRONG", awayTeamId: "F1", homeScore: 70, awayScore: 10 }),
      game({ homeTeamId: "STRONG", awayTeamId: "F2", homeScore: 70, awayScore: 10 }),
      game({ homeTeamId: "F3", awayTeamId: "WEAK", homeScore: 70, awayScore: 10 }),
      game({ homeTeamId: "F4", awayTeamId: "WEAK", homeScore: 70, awayScore: 10 }),
      // A squeaks past STRONG; B squeaks past WEAK — same final margin either way.
      game({ homeTeamId: "A", awayTeamId: "STRONG", homeScore: 30, awayScore: 28 }),
      game({ homeTeamId: "B", awayTeamId: "WEAK", homeScore: 30, awayScore: 28 }),
    ];
    const { ratings } = buildTeamRatings(games, ASOF);
    expect(ratings.get("A")!.netRating).toBeGreaterThan(ratings.get("B")!.netRating);
    // And STRONG should itself carry a higher strength-of-schedule contribution than WEAK.
    expect(ratings.get("STRONG")!.netRating).toBeGreaterThan(ratings.get("WEAK")!.netRating);
  });

  it("hand-checks offense/defense directionality: a team scoring far above average against an average opponent gets a positive offense rating, and a team allowing far above average gets a positive (worse) defense rating", () => {
    const games: CfbCompletedGame[] = [
      // HIGH_OFFENSE puts up 60 against an opponent (LOW_D) that otherwise plays at the league average.
      game({ homeTeamId: "HIGH_OFFENSE", awayTeamId: "LOW_D", homeScore: 60, awayScore: 20 }),
      // LOW_D also plays an average game elsewhere, anchoring it near average rather than purely reactive.
      game({ homeTeamId: "LOW_D", awayTeamId: "ANCHOR1", homeScore: 27, awayScore: 27 }),
      game({ homeTeamId: "HIGH_OFFENSE", awayTeamId: "ANCHOR2", homeScore: 27, awayScore: 27 }),
      game({ homeTeamId: "ANCHOR1", awayTeamId: "ANCHOR2", homeScore: 27, awayScore: 27 }),
    ];
    const { ratings } = buildTeamRatings(games, ASOF);
    expect(ratings.get("HIGH_OFFENSE")!.offenseRating).toBeGreaterThan(0);
    // LOW_D allowed 60 in one game — a well-above-average number of points allowed — so its defenseRating (points allowed above average) should be positive (worse than average).
    expect(ratings.get("LOW_D")!.defenseRating).toBeGreaterThan(0);
  });

  it("shrinks early-season ratings toward zero by the documented gamesPlayed/(gamesPlayed+SHRINK_GAMES) factor", () => {
    // Same opponent, repeated, in BOTH scenarios — keeps the schedule graph's
    // SHAPE identical (a single 2-team component) between the 1-game and
    // 8-game cases, isolating the shrink factor as the only thing that
    // differs. (Distinct one-off fillers per game would instead change the
    // component's size/shape between scenarios, which the per-component
    // recentering fix — see ratings.ts's module docstring — treats
    // differently, confounding this comparison.)
    const oneGame: CfbCompletedGame[] = [game({ homeTeamId: "ONE", awayTeamId: "FILLER", homeScore: 50, awayScore: 10 })];
    const eightGames: CfbCompletedGame[] = Array.from({ length: 8 }, () =>
      game({ homeTeamId: "EIGHT", awayTeamId: "FILLER", homeScore: 50, awayScore: 10 })
    );

    const oneRating = buildTeamRatings(oneGame, ASOF).ratings.get("ONE")!;
    const eightRating = buildTeamRatings(eightGames, ASOF).ratings.get("EIGHT")!;

    expect(oneRating.gamesPlayed).toBe(1);
    expect(eightRating.gamesPlayed).toBe(8);

    const oneShrink = 1 / (1 + SHRINK_GAMES);
    const eightShrink = 8 / (8 + SHRINK_GAMES);
    expect(eightRating.offenseRating / oneRating.offenseRating).toBeCloseTo(eightShrink / oneShrink, 6);
  });

  it("handles a team whose only opponent is itself a dead end (an FCS/unrated 'buy game' opponent) without exploding", () => {
    // FCS opponents only ever appear in our FBS-scoped feed via one FBS team's
    // schedule, so they show up here as a single-game dead end with no other
    // connections — exactly this shape.
    const games: CfbCompletedGame[] = [game({ homeTeamId: "FBS_TEAM", awayTeamId: "FCS_OPPONENT", homeScore: 55, awayScore: 3 })];
    const { ratings } = buildTeamRatings(games, ASOF);
    const fbs = ratings.get("FBS_TEAM")!;
    const fcs = ratings.get("FCS_OPPONENT")!;
    for (const r of [fbs, fcs]) {
      expect(Number.isFinite(r.offenseRating)).toBe(true);
      expect(Number.isFinite(r.defenseRating)).toBe(true);
      expect(Number.isFinite(r.netRating)).toBe(true);
    }
    // Heavily shrunk (1 game each) — should not read as an extreme, overconfident rating.
    expect(fbs.gamesPlayed).toBe(1);
    expect(Math.abs(fbs.netRating)).toBeLessThan(30);
  });

  it("keeps disconnected schedule components independently centered rather than falsely comparable", () => {
    // Two conferences that haven't played each other yet — no game links them.
    const pGames: CfbCompletedGame[] = [
      game({ homeTeamId: "P1", awayTeamId: "P2", homeScore: 30, awayScore: 20 }),
      game({ homeTeamId: "P2", awayTeamId: "P3", homeScore: 25, awayScore: 24 }),
      game({ homeTeamId: "P3", awayTeamId: "P1", homeScore: 28, awayScore: 10 }),
    ];
    const qGames: CfbCompletedGame[] = [
      game({ homeTeamId: "Q1", awayTeamId: "Q2", homeScore: 40, awayScore: 10 }),
      game({ homeTeamId: "Q2", awayTeamId: "Q3", homeScore: 35, awayScore: 7 }),
      game({ homeTeamId: "Q3", awayTeamId: "Q1", homeScore: 30, awayScore: 28 }),
    ];
    const { ratings } = buildTeamRatings([...pGames, ...qGames], ASOF);

    // Each component's own offense is centered on ITS OWN average — the
    // invariant `buildTeamRatings`'s per-component recentering actually
    // guarantees (see its module docstring). Every team here plays exactly 2
    // games, so the shrink factor is uniform within each component and this
    // zero-mean property survives shrinkage too.
    const pOffenseMean = (ratings.get("P1")!.offenseRating + ratings.get("P2")!.offenseRating + ratings.get("P3")!.offenseRating) / 3;
    const qOffenseMean = (ratings.get("Q1")!.offenseRating + ratings.get("Q2")!.offenseRating + ratings.get("Q3")!.offenseRating) / 3;
    expect(pOffenseMean).toBeCloseTo(0, 6);
    expect(qOffenseMean).toBeCloseTo(0, 6);

    // The stronger, directly relevant property: each team's OFFENSE rating is
    // completely unaffected by the other, disconnected component's results —
    // proving there's no cross-component leakage through the offense/defense
    // solver itself (see the note in ratings.ts about the smaller, separate
    // leagueAvgPoints-sharing caveat, which affects only the absolute
    // defense/net level, never the offense rating or any team's relative
    // ranking within its own component).
    const qGamesChanged: CfbCompletedGame[] = [
      game({ homeTeamId: "Q1", awayTeamId: "Q2", homeScore: 55, awayScore: 3 }),
      game({ homeTeamId: "Q2", awayTeamId: "Q3", homeScore: 48, awayScore: 0 }),
      game({ homeTeamId: "Q3", awayTeamId: "Q1", homeScore: 44, awayScore: 6 }),
    ];
    const changed = buildTeamRatings([...pGames, ...qGamesChanged], ASOF).ratings;
    expect(changed.get("P1")!.offenseRating).toBeCloseTo(ratings.get("P1")!.offenseRating, 9);
    expect(changed.get("P2")!.offenseRating).toBeCloseTo(ratings.get("P2")!.offenseRating, 9);
    expect(changed.get("P3")!.offenseRating).toBeCloseTo(ratings.get("P3")!.offenseRating, 9);
  });

  it("produces materially the same ratings regardless of the input games' order (order independence)", () => {
    const games: CfbCompletedGame[] = [
      game({ homeTeamId: "A", awayTeamId: "B", homeScore: 35, awayScore: 10 }),
      game({ homeTeamId: "A", awayTeamId: "C", homeScore: 28, awayScore: 24 }),
      game({ homeTeamId: "B", awayTeamId: "D", homeScore: 17, awayScore: 20 }),
      game({ homeTeamId: "C", awayTeamId: "D", homeScore: 31, awayScore: 17 }),
      game({ homeTeamId: "E", awayTeamId: "F", homeScore: 45, awayScore: 7 }),
      game({ homeTeamId: "E", awayTeamId: "G", homeScore: 21, awayScore: 20 }),
      game({ homeTeamId: "F", awayTeamId: "H", homeScore: 14, awayScore: 28 }),
      game({ homeTeamId: "G", awayTeamId: "H", homeScore: 24, awayScore: 24 }),
      game({ homeTeamId: "I", awayTeamId: "J", homeScore: 38, awayScore: 35 }),
      game({ homeTeamId: "I", awayTeamId: "A", homeScore: 10, awayScore: 42 }),
      game({ homeTeamId: "J", awayTeamId: "B", homeScore: 27, awayScore: 24 }),
      game({ homeTeamId: "C", awayTeamId: "E", homeScore: 20, awayScore: 20 }),
      game({ homeTeamId: "D", awayTeamId: "F", homeScore: 30, awayScore: 10 }),
      game({ homeTeamId: "G", awayTeamId: "I", homeScore: 17, awayScore: 21 }),
      game({ homeTeamId: "H", awayTeamId: "J", homeScore: 35, awayScore: 14 }),
      game({ homeTeamId: "A", awayTeamId: "D", homeScore: 24, awayScore: 20 }),
      game({ homeTeamId: "B", awayTeamId: "C", homeScore: 13, awayScore: 30 }),
      game({ homeTeamId: "E", awayTeamId: "H", homeScore: 28, awayScore: 17 }),
      game({ homeTeamId: "F", awayTeamId: "G", homeScore: 22, awayScore: 25 }),
      game({ homeTeamId: "I", awayTeamId: "B", homeScore: 31, awayScore: 28 }),
    ];

    const baseline = buildTeamRatings(games, ASOF).ratings;

    // Order-shuffling changes nothing about which games happened — every shuffle
    // must produce materially the same ratings (tight tolerance: this asserts
    // real convergence to a unique fixed point, not just "close enough").
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
    const games: CfbCompletedGame[] = [];
    for (let i = 0; i < 60; i++) {
      const home = `T${i % 20}`;
      const away = `T${(i + 7) % 20}`;
      if (home === away) continue;
      games.push(
        game({
          homeTeamId: home,
          awayTeamId: away,
          homeScore: 17 + ((i * 13) % 35),
          awayScore: 10 + ((i * 7) % 28),
          startUtc: new Date(2026, 8, 1 + (i % 90)),
        })
      );
    }
    const { ratings } = buildTeamRatings(games, ASOF);
    for (const [, r] of ratings) {
      expect(Number.isFinite(r.netRating)).toBe(true);
      expect(Math.abs(r.netRating)).toBeLessThan(200); // generous bound — real signal, not a blow-up
    }
  });

  it("is deterministic for identical input", () => {
    const games: CfbCompletedGame[] = [
      game({ homeTeamId: "A", awayTeamId: "B", homeScore: 24, awayScore: 17 }),
      game({ homeTeamId: "B", awayTeamId: "A", homeScore: 20, awayScore: 20, startUtc: new Date("2026-10-01T17:00Z") }),
    ];
    const r1 = buildTeamRatings(games, ASOF);
    const r2 = buildTeamRatings(games, ASOF);
    expect([...r1.ratings.entries()]).toEqual([...r2.ratings.entries()]);
    expect(r1.leagueAvgPoints).toBe(r2.leagueAvgPoints);
  });

  it("exposes strength-of-schedule as the average opponent net rating faced", () => {
    const games: CfbCompletedGame[] = [
      game({ homeTeamId: "X", awayTeamId: "TOUGH", homeScore: 20, awayScore: 21 }),
      game({ homeTeamId: "TOUGH", awayTeamId: "F1", homeScore: 40, awayScore: 10 }),
      game({ homeTeamId: "TOUGH", awayTeamId: "F2", homeScore: 40, awayScore: 10 }),
    ];
    const { ratings } = buildTeamRatings(games, ASOF);
    expect(ratings.get("X")!.strengthOfSchedule).toBeCloseTo(ratings.get("TOUGH")!.netRating, 9);
  });
});
