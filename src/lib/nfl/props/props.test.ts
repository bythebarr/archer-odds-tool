import { describe, expect, it } from "vitest";
import { PropState, walkForward, type GameContext, type Snapshot } from "./engine";
import { AvailabilityTracker } from "./availability";
import { LogisticCalibrator, RatioDistribution } from "./distribution";
import { project, type ModelParams } from "./model";
import type { PlayerGame, TeamGameVolume } from "./playerGames";

function pg(p: Partial<PlayerGame>): PlayerGame {
  return {
    gameId: "2020_01_B_A", season: 2020, week: 1, team: "A", opp: "B", playerId: "p1", name: "P One", position: "WR",
    offenseSnaps: 60, offensePct: 0.9, targets: 8, receptions: 5, receivingYards: 70, carries: 0, rushingYards: 0,
    passAttempts: 0, completions: 0, passingYards: 0, rushingTds: 0, receivingTds: 0, passingTds: 0,
    ...p,
  };
}
function team(t: Partial<TeamGameVolume>): TeamGameVolume {
  return { gameId: "2020_01_B_A", season: 2020, week: 1, team: "A", opp: "B", targets: 35, carries: 25, passAttempts: 36, tds: 3, passingTds: 2, ...t };
}

const ctx = new Map<string, GameContext>();
const params = { halfLife: 8, seasonCarry: 1 };

function snapshotsFor(players: PlayerGame[], teams: TeamGameVolume[]): Snapshot[] {
  const out: Snapshot[] = [];
  walkForward(players, teams, ctx, params, (s) => out.push(s));
  return out;
}

describe("walkForward", () => {
  const history = [
    pg({ week: 1, gameId: "g1", targets: 8, receivingYards: 70 }),
    pg({ week: 2, gameId: "g2", targets: 10, receivingYards: 90 }),
    pg({ week: 3, gameId: "g3", targets: 9, receivingYards: 80 }),
  ];
  const teams = [team({ week: 1, gameId: "g1" }), team({ week: 2, gameId: "g2" }), team({ week: 3, gameId: "g3" })];

  it("snapshots each game from state strictly before its week", () => {
    const snaps = snapshotsFor(history, teams);
    expect(snaps[0].player.games).toBe(0);
    expect(snaps[1].player.tgt).toBe(8);
    const decay = Math.pow(0.5, 1 / 8);
    expect(snaps[2].player.tgt).toBeCloseTo(8 * decay + 10, 12);
  });

  it("a game's own (or a later game's) outcome never changes its snapshot", () => {
    const base = snapshotsFor(history, teams)[2];
    const altered = snapshotsFor(
      history.map((g) => (g.week >= 3 ? { ...g, targets: 40, receivingYards: 400 } : g)),
      teams.map((t) => (t.week >= 3 ? { ...t, targets: 80 } : t))
    )[2];
    expect(altered.player).toEqual(base.player);
    expect(altered.team).toEqual(base.team);
  });
});

describe("RatioDistribution", () => {
  it("is monotone in the line and in the projection", () => {
    const pairs = Array.from({ length: 2000 }, (_, i) => ({ mu: 20 + (i % 60), y: (20 + (i % 60)) * (0.2 + ((i * 7919) % 100) / 60) }));
    const d = RatioDistribution.fit(pairs);
    expect(d.pOver(50, 30)).toBeGreaterThan(d.pOver(50, 60));
    expect(d.pOver(70, 50)).toBeGreaterThanOrEqual(d.pOver(40, 50));
    for (const L of [0, 1000]) {
      const p = d.pOver(50, L);
      expect(p).toBeGreaterThanOrEqual(0.02);
      expect(p).toBeLessThanOrEqual(0.98);
    }
  });
});

describe("LogisticCalibrator", () => {
  it("learns to pull overconfident probabilities toward 0.5", () => {
    // stated 0.9 but true rate 0.7; stated 0.1 but true rate 0.3
    const pairs: { p: number; y: 0 | 1 }[] = [];
    for (let i = 0; i < 1000; i++) pairs.push({ p: 0.9, y: i % 10 < 7 ? 1 : 0 }, { p: 0.1, y: i % 10 < 3 ? 1 : 0 });
    const c = LogisticCalibrator.fit(pairs);
    expect(c.b).toBeLessThan(1);
    expect(c.apply(0.9)).toBeCloseTo(0.7, 2);
    expect(c.apply(0.1)).toBeCloseTo(0.3, 2);
  });
});

describe("project", () => {
  it("composes volume × share × efficiency", () => {
    const snaps = snapshotsFor(
      [pg({ week: 1, gameId: "g1" }), pg({ week: 2, gameId: "g2" })],
      [team({ week: 1, gameId: "g1" }), team({ week: 2, gameId: "g2" })]
    );
    const s = snaps[1];
    const params: ModelParams = {
      shrink: { kTgtShare: 1e-9, kCarShare: 1, kAttShare: 1, kCatch: 1e-9, kYpt: 1e-9, kYpc: 1, kCmp: 1, kYpa: 1 },
      opp: { kDef: 100, gammaRec: 0, gammaRush: 0, gammaPass: 0 },
      // team targets = exactly 40
      volume: { tgt: [40, 0, 0, 0, 0], car: [25, 0, 0, 0, 0], att: [36, 0, 0, 0, 0] },
    };
    const p = project({ usage: s, efficiency: s, team: s, defense: s }, params);
    // share 8/35, catch 5/8, ypt 70/8 (no shrinkage, no opponent adjustment)
    expect(p.receptions).toBeCloseTo(40 * (8 / 35) * (5 / 8), 6);
    expect(p.receivingYards).toBeCloseTo(40 * (8 / 35) * (70 / 8), 6);
  });
});

describe("AvailabilityTracker", () => {
  const shrink = { kTgtShare: 1e-9, kCarShare: 1e-9, kAttShare: 1, kCatch: 1, kYpt: 1, kYpc: 1, kCmp: 1, kYpa: 1 };
  const rb = (week: number, playerId: string, carries: number, teamCode = "A") =>
    pg({ week, gameId: `g${week}`, playerId, name: playerId, position: "RB", team: teamCode, carries, targets: 0, receptions: 0, receivingYards: 0 });
  const tm = (week: number) => team({ week, gameId: `g${week}`, carries: 25 });

  function run(weeks: number, rbs: (w: number) => PlayerGame[]) {
    const state = new PropState({ halfLife: 4, seasonCarry: 1 });
    const avail = new AvailabilityTracker(4);
    const all = Array.from({ length: weeks }, (_, i) => i + 1);
    const tv = all.map((w) => tm(w));
    const teamGame = new Map(tv.map((t) => [`${t.gameId}|${t.team}`, t]));
    for (const w of all) {
      const wk = rbs(w);
      state.foldWeek(wk, [tv[w - 1]], teamGame);
      avail.foldWeek(wk);
    }
    return { state, avail };
  }
  const key = { gameId: "g9", season: 2020, week: 9, opp: "B" };

  it("a fresh absence frees the absent player's full carry share", () => {
    const { state, avail } = run(3, (w) => [rb(w, "starter", 15), rb(w, "backup", 5)]);
    const ctx = avail.context("A", key, [{ playerId: "starter", team: "A", position: "RB", status: "Out" }], state, shrink, undefined);
    expect(ctx.vacCar.RB).toBeCloseTo(15 / 25, 6);
    expect(ctx.absent[0].name).toBe("starter");
  });

  it("a long absence frees less, at the usage half-life", () => {
    const { state, avail } = run(7, (w) => (w <= 3 ? [rb(w, "starter", 15), rb(w, "backup", 5)] : [rb(w, "backup", 15)]));
    const ctx = avail.context("A", key, [{ playerId: "starter", team: "A", position: "RB", status: "Out" }], state, shrink, undefined);
    expect(ctx.vacCar.RB).toBeCloseTo((15 / 25) * Math.pow(0.5, 4 / 4), 6);
  });

  it("ignores ruled-out players whose last game was for another team", () => {
    const { state, avail } = run(3, (w) => [rb(w, "starter", 15, "C"), rb(w, "backup", 5)]);
    const ctx = avail.context("A", key, [{ playerId: "starter", team: "A", position: "RB", status: "Out" }], state, shrink, undefined);
    expect(ctx.vacCar.RB).toBe(0);
  });
});
