import { describe, expect, it } from "vitest";
import { countCdf, MIN_GAMES, THIN_MIN_GAMES, positionRates, probOver, projectProp, rawOver } from "./projection";
import { NBA_PROP_STAT_BY_KEY } from "./propStats";
import type { GameLogPoint } from "./propsMath";
import type { DefenseTable } from "./matchup";

const PTS = NBA_PROP_STAT_BY_KEY.get("points")!;
const line = (points: number) => ({ points, rebounds: 40, assists: 25, threesMade: 12, steals: 8, blocks: 5, turnovers: 3 });
const defense: DefenseTable = {
  season: 2026,
  fromLastSeason: false,
  teams: {
    SOFT: { games: 20, allowed: line(124), combinedPoints: 236, byPosition: {} },
    MID: { games: 20, allowed: line(114), combinedPoints: 226, byPosition: {} },
    TUFF: { games: 20, allowed: line(104), combinedPoints: 216, byPosition: {} },
  },
};
const log = (points: number, minutes = 34, i = 0): GameLogPoint => ({
  date: `2026-10-${String(20 - (i % 19)).padStart(2, "0")}`,
  opponent: "MID",
  isHome: true,
  season: 2026,
  minutes,
  points,
  rebounds: 5,
  assists: 5,
  threesMade: 2,
  steals: 1,
  blocks: 0,
  turnovers: 0,
});
const steady = (n: number, pts = 25) => Array.from({ length: n }, (_, i) => log(pts + (i % 3) - 1, 34, i));

describe("countCdf", () => {
  it("is a proper Poisson CDF when variance equals the mean", () => {
    expect(countCdf(0, 2, 2)).toBeCloseTo(Math.exp(-2), 6);
    expect(countCdf(200, 25, 25)).toBeCloseTo(1, 6);
  });
  it("spreads mass when over-dispersed", () => {
    // Same mean, wider variance: more mass in the tails, so less at or below the mean.
    expect(countCdf(25, 25, 60)).toBeLessThan(countCdf(25, 25, 25) + 0.02);
    expect(countCdf(10, 25, 60)).toBeGreaterThan(countCdf(10, 25, 25));
  });
});

describe("projectProp", () => {
  it("needs a minimum sample", () => {
    expect(projectProp(steady(THIN_MIN_GAMES - 1), PTS, { defense, opponent: "MID", positionGroup: null })).toBeNull();
    expect(projectProp(steady(MIN_GAMES), PTS, { defense, opponent: "MID", positionGroup: null })!.thin).toBe(false);
  });

  it("projects a rookie from his second game, steadied by his position and with a wider range", () => {
    // Two hot nights at 34 min (about 1.0 pts/min); guards league-wide score 0.5 pts/min.
    const rookie = [log(36, 34, 0), log(32, 34, 1)];
    const ctx = { defense, opponent: "MID", positionGroup: "G" as const };
    const alone = projectProp(rookie, PTS, ctx)!;
    const steadied = projectProp(rookie, PTS, { ...ctx, positionRates: { points: 0.5 } })!;
    expect(alone.thin).toBe(true);
    expect(steadied.mean).toBeLessThan(alone.mean); // pulled toward the position's rate
    expect(steadied.mean).toBeGreaterThan(0.5 * 34); // but still his own minutes and more than the average guard
    // The same mean from a full sample would carry a narrower range.
    const veteran = projectProp(steady(20, 34), PTS, ctx)!;
    expect(steadied.sd / Math.sqrt(steadied.mean)).toBeGreaterThan(veteran.sd / Math.sqrt(veteran.mean));
  });


  it("projects near the player's level against an average opponent", () => {
    const p = projectProp(steady(20), PTS, { defense, opponent: "MID", positionGroup: null })!;
    expect(p.mean).toBeGreaterThan(23.5);
    expect(p.mean).toBeLessThan(26.5);
    expect(p.minutes).toBeCloseTo(34, 1);
  });

  it("moves with the matchup, capped", () => {
    const soft = projectProp(steady(20), PTS, { defense, opponent: "SOFT", positionGroup: null })!;
    const tough = projectProp(steady(20), PTS, { defense, opponent: "TUFF", positionGroup: null })!;
    expect(soft.mean).toBeGreaterThan(tough.mean);
    expect(soft.matchupFactor).toBeLessThanOrEqual(1.12);
    expect(tough.matchupFactor).toBeGreaterThanOrEqual(0.88);
  });

  it("follows a minutes change", () => {
    const recentBump = [...Array.from({ length: 5 }, (_, i) => log(30, 40, i)), ...Array.from({ length: 15 }, (_, i) => log(20, 28, i + 5))];
    const p = projectProp(recentBump, PTS, { defense, opponent: "MID", positionGroup: null })!;
    expect(p.minutes).toBeGreaterThan(33);
  });
});

describe("probOver", () => {
  const proj = projectProp(steady(20), PTS, { defense, opponent: "MID", positionGroup: null })!;
  it("falls as the line rises", () => {
    expect(probOver(proj, 20.5)).toBeGreaterThan(probOver(proj, 25.5));
    expect(probOver(proj, 25.5)).toBeGreaterThan(probOver(proj, 30.5));
  });
  it("is near even at the projection", () => {
    const p = probOver(proj, Math.round(proj.mean) - 0.5);
    expect(p).toBeGreaterThan(0.45);
    expect(p).toBeLessThan(0.65);
  });
});

describe("teammate absences", () => {
  it("leans on the games without the absent teammate", () => {
    // Recent 10 games: the star played in the odd ones; in the even ones our player
    // took over (40 min, 35 pts). Mixed history overall.
    const logs = Array.from({ length: 20 }, (_, i) => ({ ...log(i % 2 ? 22 : 35, i % 2 ? 30 : 40, i), date: `2026-10-${String(30 - i).padStart(2, "0")}` }));
    const starDates = logs.filter((_, i) => i % 2).map((l) => l.date);
    const base = projectProp(logs, PTS, { defense, opponent: "MID", positionGroup: null })!;
    const adj = projectProp(logs, PTS, { defense, opponent: "MID", positionGroup: null, absences: [{ name: "Star", status: "Out", playedDates: starDates, usage: 34 }] })!;
    expect(adj.absence).toMatchObject({ names: ["Star"], games: 10 });
    expect(adj.mean).toBeGreaterThan(base.mean);
  });
});

describe("projectMilestone", () => {
  const big = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      date: `2026-10-${String(30 - i).padStart(2, "0")}`,
      opponent: "MID",
      isHome: true,
      season: 2026,
      minutes: 36,
      points: 26,
      rebounds: 12,
      assists: 7,
      threesMade: 1,
      steals: 1,
      blocks: 1,
      turnovers: 3,
    }));
  it("makes a 26-and-12 big a heavy double-double favorite and a long triple-double shot", async () => {
    const { projectMilestone } = await import("./projection");
    const { NBA_PROP_STAT_BY_KEY } = await import("./propStats");
    const comps = (["points", "rebounds", "assists", "steals", "blocks"] as const).map((k) => NBA_PROP_STAT_BY_KEY.get(k)!);
    const ctx = { defense: { season: 0, fromLastSeason: false, teams: {} }, opponent: null, positionGroup: null };
    const dd = projectMilestone(big(20), comps, 2, ctx)!;
    const td = projectMilestone(big(20), comps, 3, ctx)!;
    expect(dd.mean).toBeGreaterThan(0.6);
    expect(td.mean).toBeLessThan(0.25);
    expect(rawOver(dd, 0.5)).toBeCloseTo(dd.mean, 6);
  });
});

describe("positionRates", () => {
  it("is each position group's per-minute rate, skipping thin groups", () => {
    const logs = { a: Array.from({ length: 20 }, (_, i) => log(20, 30, i)), b: [log(10, 30)] };
    const rates = positionRates([{ id: "a", positionGroup: "G" }, { id: "b", positionGroup: "C" }], logs, [PTS]);
    expect(rates.G.points).toBeCloseTo(20 / 30);
    expect(rates.C).toBeUndefined(); // 30 minutes isn't enough to read a position's rate
  });
});
