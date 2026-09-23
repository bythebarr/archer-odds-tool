/**
 * The one walk-forward replay every consumer of the frozen prop model shares:
 * the live projector (upcoming week), and experiments that build new markets
 * on top of the frozen model (touchdowns, combos, interceptions, …). Before
 * this existed, each re-implemented the same loop, and the copies could
 * drift.
 *
 * `PropReplayer` holds every piece of pre-week state: one `PropState` per
 * component group (with the frozen decay parameters), the touchdown-share
 * state, eligibility (baselines, presumed starting QB), and availability
 * (who's played for whom, for vacated usage). `view()` reads it for one
 * player-game key, and `foldWeek()` adds a finished week. Callers must view a
 * week's games before folding that week in; `replayHistory` does exactly
 * that.
 */
import { AvailabilityTracker, NO_ABSENCES, type AvailabilityContext } from "./availability";
import { EligibilityTracker, type Baseline } from "./eligibility";
import { PropState, weekKeyOf, type GameContext, type PlayerGameKey, type Snapshot } from "./engine";
import type { FrozenModelFile } from "./frozen";
import { ruledOut, type InjuryIndex } from "./injuries";
import { adjusted, components, oppFactors, project, type Components, type OppFactors, type Projection, type SnapshotSet } from "./model";
import type { PlayerGame, TeamGameVolume } from "./playerGames";
import { passTdFraction, passTdLambda, projectTeamTds, tdShare } from "./td";

export interface PlayerView {
  set: SnapshotSet;
  avail: AvailabilityContext;
  baseline: Baseline;
  /** Every game this player played before this week, oldest first (a copy — safe to keep). */
  history: readonly PlayerGame[];
  /** The seven volume/yardage means (with v1.1 availability). */
  proj: Projection;
  /** Components after availability adjustment, and team volumes — for "why" breakdowns. */
  adj: ReturnType<typeof adjusted>;
  /** Unadjusted components (what the TD model was fit on). */
  base: Components;
  opp: OppFactors;
  td: { teamTds: number; share: number; anytimeLambda: number; passFrac: number; passLambda: number } | null;
  tdSnap: Snapshot | null;
}

export class PropReplayer {
  readonly states: Record<"usage" | "efficiency" | "team" | "defense", PropState>;
  readonly tdState: PropState | null;
  readonly tracker = new EligibilityTracker();
  readonly avail: AvailabilityTracker;
  private readonly availCache = new Map<string, AvailabilityContext>();

  constructor(private readonly model: FrozenModelFile) {
    const e = model.engine;
    this.states = {
      usage: new PropState(e.usage),
      efficiency: new PropState(e.efficiency),
      team: new PropState(e.team),
      defense: new PropState(e.defense),
    };
    this.tdState = model.td ? new PropState({ halfLife: model.td.halfLife, seasonCarry: e.usage.seasonCarry }) : null;
    this.avail = new AvailabilityTracker(e.usage.halfLife);
  }

  /** Availability for a team's game this week from the injury report (cached per team-week). */
  availability(team: string, key: Omit<PlayerGameKey, "playerId" | "name" | "position" | "team">, injuries: InjuryIndex): AvailabilityContext {
    const cacheKey = `${key.season}|${key.week}|${team}`;
    const hit = this.availCache.get(cacheKey);
    if (hit) return hit;
    const out = ruledOut(injuries, key.season, key.week, team);
    const ctx = out.length
      ? this.avail.context(team, key, out, this.states.usage, this.model.params.shrink, this.tracker.leadPasser(team))
      : NO_ABSENCES;
    this.availCache.set(cacheKey, ctx);
    return ctx;
  }

  view(key: PlayerGameKey, gctx: GameContext | undefined, injuries: InjuryIndex): PlayerView {
    const wk = weekKeyOf(key.season, key.week);
    const set: SnapshotSet = {
      usage: this.states.usage.snapshot(key, gctx, wk),
      efficiency: this.states.efficiency.snapshot(key, gctx, wk),
      team: this.states.team.snapshot(key, gctx, wk),
      defense: this.states.defense.snapshot(key, gctx, wk),
    };
    const { params, td } = this.model;
    const avail = this.availability(key.team, { gameId: key.gameId, season: key.season, week: key.week, opp: key.opp }, injuries);
    const base = components(set, params.shrink);
    const tdSnap = this.tdState ? this.tdState.snapshot(key, gctx, wk) : null;
    let tdView: PlayerView["td"] = null;
    if (td && tdSnap) {
      const teamTds = projectTeamTds(set.team, td.params);
      const share = tdShare(tdSnap, base, td.params);
      const passFrac = passTdFraction(set.team, td.params.kPassFrac);
      tdView = { teamTds, share, anytimeLambda: teamTds * share, passFrac, passLambda: passTdLambda(teamTds, passFrac, base.attShare) };
    }
    return {
      set,
      avail,
      baseline: this.tracker.baseline(key),
      history: this.tracker.gamesOf(key.playerId).slice(),
      proj: project(set, params, avail),
      adj: adjusted(set, params, avail),
      base,
      opp: oppFactors(set.defense, params.opp),
      td: tdView,
      tdSnap,
    };
  }

  foldWeek(wp: readonly PlayerGame[], wt: readonly TeamGameVolume[], teamGame: ReadonlyMap<string, TeamGameVolume>): void {
    for (const s of Object.values(this.states)) s.foldWeek(wp, wt, teamGame);
    this.tdState?.foldWeek(wp, wt, teamGame);
    this.tracker.foldWeek(wp);
    this.avail.foldWeek(wp);
  }
}

/** Group player-games and team-games by week key, in chronological order. */
export function groupWeeks(players: readonly PlayerGame[], teams: readonly TeamGameVolume[]) {
  const byWeek = new Map<string, PlayerGame[]>();
  for (const p of players) {
    const k = weekKeyOf(p.season, p.week);
    (byWeek.get(k) ?? byWeek.set(k, []).get(k)!).push(p);
  }
  const teamsByWeek = new Map<string, TeamGameVolume[]>();
  for (const t of teams) {
    const k = weekKeyOf(t.season, t.week);
    (teamsByWeek.get(k) ?? teamsByWeek.set(k, []).get(k)!).push(t);
  }
  const weeks = [...new Set([...byWeek.keys(), ...teamsByWeek.keys()])].sort();
  return { weeks, byWeek, teamsByWeek, teamGame: new Map(teams.map((t) => [`${t.gameId}|${t.team}`, t])) };
}

/**
 * Replay history: every played player-game is viewed strictly pre-week, then
 * the week is folded in. Returns the replayer in its final (all folded) state.
 */
export function replayHistory(
  model: FrozenModelFile,
  players: readonly PlayerGame[],
  teams: readonly TeamGameVolume[],
  ctx: ReadonlyMap<string, GameContext>,
  injuries: InjuryIndex,
  onView?: (pg: PlayerGame, view: PlayerView) => void
): PropReplayer {
  const r = new PropReplayer(model);
  const { weeks, byWeek, teamsByWeek, teamGame } = groupWeeks(players, teams);
  for (const wk of weeks) {
    const wp = byWeek.get(wk) ?? [];
    if (onView) for (const pg of wp) onView(pg, r.view(pg, ctx.get(pg.gameId), injuries));
    r.foldWeek(wp, teamsByWeek.get(wk) ?? [], teamGame);
  }
  return r;
}
