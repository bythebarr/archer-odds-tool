/**
 * NFL player-prop projection: expected stat = volume × share × efficiency,
 * each piece empirical-Bayes shrunk toward a population prior, with an
 * opponent adjustment on efficiency. Pure — takes `engine.ts` snapshots plus
 * fitted parameters (see `scripts/experiment-nfl-props.ts` for the fit).
 *
 *   targets        = teamTargets(proj) × targetShare
 *   receptions     = targets × catchRate
 *   receivingYards = targets × yardsPerTarget × oppAdj(yds/target allowed to this position)
 *   carries        = teamCarries(proj) × carryShare
 *   rushingYards   = carries × yardsPerCarry × oppAdj(yds/carry allowed)
 *   passAttempts   = teamAttempts(proj) × attemptShare
 *   completions    = passAttempts × completionRate
 *   passingYards   = passAttempts × yardsPerAttempt × oppAdj(yds/attempt allowed)
 *
 * Share priors scale the league's per-snap rate by the player's own (lagged)
 * snap share, so a full-time WR1 and a rotational WR4 start from different
 * places before either has a target. Team volume is a linear model in the
 * team's own recent volume, what the opponent allows, and the pregame spread
 * and total (game script: favorites run, trailing teams throw).
 */
import type { Snapshot } from "./engine";
import { redistributionTerms, type AvailabilityContext } from "./availability";
import type { PlayerGame } from "./playerGames";

export const PROP_MARKETS = ["receptions", "receivingYards", "rushAttempts", "rushingYards", "passAttempts", "completions", "passingYards"] as const;
export type PropMarket = (typeof PROP_MARKETS)[number];

export interface ShrinkParams {
  kTgtShare: number;
  kCarShare: number;
  kAttShare: number;
  kCatch: number;
  kYpt: number;
  kYpc: number;
  kCmp: number;
  kYpa: number;
}

export interface OppParams {
  kDef: number;
  gammaRec: number;
  gammaRush: number;
  gammaPass: number;
}

/** [intercept, team recent volume/game, opponent volume allowed/game, team spread, game total]. */
export type VolumeCoefs = [number, number, number, number, number];

export interface VolumeParams {
  tgt: VolumeCoefs;
  car: VolumeCoefs;
  att: VolumeCoefs;
}

/**
 * v1.1 availability adjustments (see availability.ts). Share multipliers are
 * 1 + same·(vacated same-position share)/(1−V) + other·(vacated other)/(1−V);
 * QB-out factors multiply team volume and receiver efficiency when the
 * presumed starter is ruled out. Absent (v1.0) = no adjustment.
 */
export interface AvailabilityParams {
  tgtSame: number;
  tgtOther: number;
  carSame: number;
  carOther: number;
  qbOutTgt: number;
  qbOutCar: number;
  qbOutCatch: number;
  qbOutYpt: number;
  /**
   * v1.2 candidate: depth-aware target redistribution — an ADDITIVE share bump
   * weighted by (1 − the player's snap share), so the receiver who steps into
   * the vacated snaps gains most rather than the one who already had the
   * biggest share. Absent = 0.
   */
  tgtSameDepth?: number;
  tgtOtherDepth?: number;
}

export interface ModelParams {
  shrink: ShrinkParams;
  opp: OppParams;
  volume: VolumeParams;
  availability?: AvailabilityParams;
}

/** Snapshots per component group — each group may use a different decay half-life. */
export interface SnapshotSet {
  usage: Snapshot;
  efficiency: Snapshot;
  team: Snapshot;
  defense: Snapshot;
}

const DEFAULT_TOTAL = 44;
/** Pseudo-games of league-average volume blended into a team's recent volume, so week 1 isn't a divide-by-zero. */
const TEAM_PSEUDO_GAMES = 1;

export function volumeFeatures(s: Snapshot, kind: "tgt" | "car" | "att"): number[] {
  const leagueVol = kind === "tgt" ? s.league.teamTgt : kind === "car" ? s.league.teamCar : s.league.teamAtt;
  const teamSum = kind === "tgt" ? s.team.tgt : kind === "car" ? s.team.car : s.team.att;
  const allowedSum = kind === "tgt" ? s.oppDef.tgtA : kind === "car" ? s.oppDef.carA : s.oppDef.attA;
  const teamPerGame = (teamSum + TEAM_PSEUDO_GAMES * leagueVol) / (s.team.games + TEAM_PSEUDO_GAMES);
  const allowedPerGame = (allowedSum + TEAM_PSEUDO_GAMES * leagueVol) / (s.oppDef.games + TEAM_PSEUDO_GAMES);
  return [1, teamPerGame, allowedPerGame, s.teamSpread ?? 0, s.total ?? DEFAULT_TOTAL];
}

const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const shrink = (num: number, den: number, prior: number, k: number) => (num + k * prior) / (den + k);

export function snapShare(s: Snapshot): number {
  return s.player.games > 0 ? s.player.snapPct / s.player.games : 0;
}

export interface Components {
  tgtShare: number;
  carShare: number;
  attShare: number;
  catchRate: number;
  ypt: number;
  ypc: number;
  cmpRate: number;
  ypa: number;
}

export function components(set: Pick<SnapshotSet, "usage" | "efficiency">, p: ShrinkParams): Components {
  const u = set.usage;
  const e = set.efficiency;
  const pos = u.pg.position;
  const lg = u.league;
  const snap = snapShare(u);
  return {
    tgtShare: shrink(u.player.tgt, u.player.teamTgt, lg.tgtPerSnap[pos] * snap, p.kTgtShare),
    carShare: shrink(u.player.car, u.player.teamCar, lg.carPerSnap[pos] * snap, p.kCarShare),
    attShare: shrink(u.player.att, u.player.teamAtt, lg.qbAttShare, p.kAttShare),
    catchRate: shrink(e.player.rec, e.player.tgt, e.league.catchRate[pos], p.kCatch),
    ypt: shrink(e.player.recYds, e.player.tgt, e.league.ypt[pos], p.kYpt),
    ypc: shrink(e.player.rushYds, e.player.car, e.league.ypc[pos], p.kYpc),
    cmpRate: shrink(e.player.cmp, e.player.att, e.league.cmpRate, p.kCmp),
    ypa: shrink(e.player.passYds, e.player.att, e.league.ypa, p.kYpa),
  };
}

export interface OppFactors {
  rec: number;
  rush: number;
  pass: number;
}

/** Opponent efficiency allowed relative to league, shrunk, then damped by γ. 1 = neutral. */
export function oppFactors(d: Snapshot, o: OppParams): OppFactors {
  const pos = d.pg.position;
  const lg = d.league;
  const def = d.oppDef;
  const recPos = pos === "QB" ? "WR" : pos;
  const tgtA = def[`tgt${recPos}`];
  const ydsA = def[`yds${recPos}`];
  const recRatio = shrink(ydsA, tgtA, lg.ypt[recPos], o.kDef) / lg.ypt[recPos];
  const rushRatio = shrink(def.rushYds, def.rushCar, lg.ypc.RB, o.kDef) / lg.ypc.RB;
  const passRatio = shrink(def.passYds, def.passAtt, lg.ypa, o.kDef) / lg.ypa;
  return {
    rec: 1 + o.gammaRec * (recRatio - 1),
    rush: 1 + o.gammaRush * (rushRatio - 1),
    pass: 1 + o.gammaPass * (passRatio - 1),
  };
}

export type Projection = Record<PropMarket, number>;

/** Components and team volume after v1.1 availability adjustments (identity when either argument is absent). */
export function adjusted(set: SnapshotSet, params: ModelParams, avail?: AvailabilityContext) {
  const c = { ...components(set, params.shrink) };
  let teamTgt = Math.max(0, dot(params.volume.tgt, volumeFeatures(set.team, "tgt")));
  let teamCar = Math.max(0, dot(params.volume.car, volumeFeatures(set.team, "car")));
  let teamAtt = Math.max(0, dot(params.volume.att, volumeFeatures(set.team, "att")));
  const a = params.availability;
  if (a && avail) {
    const pos = set.usage.pg.position;
    const t = redistributionTerms(avail.vacTgt, pos);
    const r = redistributionTerms(avail.vacCar, pos);
    c.tgtShare *= Math.max(0, 1 + a.tgtSame * t.same + a.tgtOther * t.other);
    c.carShare *= Math.max(0, 1 + a.carSame * r.same + a.carOther * r.other);
    if (a.tgtSameDepth || a.tgtOtherDepth) {
      const headroom = 1 - Math.min(1, snapShare(set.usage));
      const vs = avail.vacTgt[pos];
      const vo = avail.vacTgt.QB + avail.vacTgt.RB + avail.vacTgt.WR + avail.vacTgt.TE - vs;
      c.tgtShare = Math.max(0, c.tgtShare + ((a.tgtSameDepth ?? 0) * vs + (a.tgtOtherDepth ?? 0) * vo) * headroom);
    }
    if (avail.qbOut) {
      teamTgt *= a.qbOutTgt;
      teamAtt *= a.qbOutTgt;
      teamCar *= a.qbOutCar;
      if (pos !== "QB") {
        c.catchRate *= a.qbOutCatch;
        c.ypt *= a.qbOutYpt;
      }
    }
  }
  return { c, teamTgt, teamCar, teamAtt };
}

export function project(set: SnapshotSet, params: ModelParams, avail?: AvailabilityContext): Projection {
  const { c, teamTgt, teamCar, teamAtt } = adjusted(set, params, avail);
  const f = oppFactors(set.defense, params.opp);
  const targets = teamTgt * c.tgtShare;
  const carries = teamCar * c.carShare;
  const attempts = teamAtt * c.attShare;
  return {
    receptions: targets * c.catchRate,
    receivingYards: targets * c.ypt * f.rec,
    rushAttempts: carries,
    rushingYards: carries * c.ypc * f.rush,
    passAttempts: attempts,
    completions: attempts * c.cmpRate,
    passingYards: attempts * c.ypa * f.pass,
  };
}

export function actualFor(s: { pg: PlayerGame }, market: PropMarket): number {
  const g = s.pg;
  switch (market) {
    case "receptions": return g.receptions;
    case "receivingYards": return g.receivingYards;
    case "rushAttempts": return g.carries;
    case "rushingYards": return g.rushingYards;
    case "passAttempts": return g.passAttempts;
    case "completions": return g.completions;
    case "passingYards": return g.passingYards;
  }
}
