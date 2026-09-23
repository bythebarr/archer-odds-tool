/**
 * Walk-forward state for NFL player-prop projections. Pure; no I/O.
 *
 * Chronological by (season, week). For each week, every eligible player-game is
 * snapshotted from the state as it stood BEFORE that week, and only then is the
 * week's box score folded in — so no projection can see its own game or any
 * later one (the same week-level as-of rule as the game models; see
 * docs/architecture/NFL-PBP-FEASIBILITY.md).
 *
 * State is exponentially decayed per game played (half-life `halfLife` games),
 * with an extra `seasonCarry` multiplier at each season boundary, for:
 *   - each player: volume (targets/carries/attempts), the team volume in the
 *     games he played (for shares), efficiency numerators, and snap share;
 *   - each offense: volume per game;
 *   - each defense: volume and efficiency allowed, split by receiver position.
 * League rates are cumulative (undecayed) over every prior game — population
 * priors built only from the past.
 *
 * This file produces raw decayed sums; turning them into shrunk rates and a
 * projection is `model.ts`'s job, so hyperparameters can be fit without
 * re-walking history.
 */
import type { PlayerGame, SkillPosition, TeamGameVolume } from "./playerGames";

export interface EngineParams {
  halfLife: number;
  seasonCarry: number;
}

/** Decayed sums keyed by field name. */
class Acc<K extends string> {
  readonly s: Record<K, number>;
  private lastSeason: number | null = null;
  constructor(private readonly keys: readonly K[]) {
    this.s = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  }
  add(season: number, v: Partial<Record<K, number>>, params: EngineParams): void {
    const decay = Math.pow(0.5, 1 / params.halfLife) * (this.lastSeason !== null && season !== this.lastSeason ? params.seasonCarry : 1);
    for (const k of this.keys) this.s[k] = this.s[k] * decay + (v[k] ?? 0);
    this.lastSeason = season;
  }
  snapshot(): Record<K, number> {
    return { ...this.s };
  }
}

const PLAYER_KEYS = ["games", "snapPct", "tgt", "teamTgt", "rec", "recYds", "car", "teamCar", "rushYds", "att", "teamAtt", "cmp", "passYds"] as const;
const TEAM_KEYS = ["games", "tgt", "car", "att"] as const;
const DEF_KEYS = [
  "games", "tgtA", "carA", "attA",
  "tgtWR", "recWR", "ydsWR", "tgtTE", "recTE", "ydsTE", "tgtRB", "recRB", "ydsRB",
  "rushCar", "rushYds", "passAtt", "passCmp", "passYds",
] as const;

type PlayerSums = Record<(typeof PLAYER_KEYS)[number], number>;
type TeamSums = Record<(typeof TEAM_KEYS)[number], number>;
type DefSums = Record<(typeof DEF_KEYS)[number], number>;

/** Cumulative league totals by position, for population priors. */
export interface LeagueRates {
  /** Targets per (team target × snap share) — scales a player's snap share into an expected target share. */
  tgtPerSnap: Record<SkillPosition, number>;
  carPerSnap: Record<SkillPosition, number>;
  catchRate: Record<SkillPosition, number>;
  ypt: Record<SkillPosition, number>;
  ypc: Record<SkillPosition, number>;
  qbAttShare: number;
  cmpRate: number;
  ypa: number;
  teamTgt: number;
  teamCar: number;
  teamAtt: number;
}

export interface Snapshot {
  pg: PlayerGame;
  weekKey: string;
  /** Spread from the player's team's perspective (+ = favored), and game total — pregame market context. */
  teamSpread: number | null;
  total: number | null;
  player: PlayerSums;
  team: TeamSums;
  oppDef: DefSums;
  league: LeagueRates;
}

const POSITIONS: SkillPosition[] = ["QB", "RB", "WR", "TE"];

class League {
  private tgt = { QB: 0, RB: 0, WR: 0, TE: 0 };
  private tgtBase = { QB: 0, RB: 0, WR: 0, TE: 0 };
  private car = { QB: 0, RB: 0, WR: 0, TE: 0 };
  private carBase = { QB: 0, RB: 0, WR: 0, TE: 0 };
  private rec = { QB: 0, RB: 0, WR: 0, TE: 0 };
  private recYds = { QB: 0, RB: 0, WR: 0, TE: 0 };
  private rushYds = { QB: 0, RB: 0, WR: 0, TE: 0 };
  private qbAtt = 0;
  private qbTeamAtt = 0;
  private cmp = 0;
  private passYds = 0;
  private teamGames = 0;
  private teamTgt = 0;
  private teamCar = 0;
  private teamAtt = 0;

  addPlayer(pg: PlayerGame, team: TeamGameVolume): void {
    const p = pg.position;
    this.tgt[p] += pg.targets;
    this.tgtBase[p] += team.targets * pg.offensePct;
    this.car[p] += pg.carries;
    this.carBase[p] += team.carries * pg.offensePct;
    this.rec[p] += pg.receptions;
    this.recYds[p] += pg.receivingYards;
    this.rushYds[p] += pg.rushingYards;
    if (p === "QB") {
      this.qbAtt += pg.passAttempts;
      this.qbTeamAtt += team.passAttempts;
      this.cmp += pg.completions;
      this.passYds += pg.passingYards;
    }
  }
  addTeam(t: TeamGameVolume): void {
    this.teamGames++;
    this.teamTgt += t.targets;
    this.teamCar += t.carries;
    this.teamAtt += t.passAttempts;
  }
  rates(): LeagueRates {
    const by = (f: (p: SkillPosition) => number) => Object.fromEntries(POSITIONS.map((p) => [p, f(p)])) as Record<SkillPosition, number>;
    const safe = (a: number, b: number, d: number) => (b > 0 ? a / b : d);
    return {
      tgtPerSnap: by((p) => safe(this.tgt[p], this.tgtBase[p], 0.1)),
      carPerSnap: by((p) => safe(this.car[p], this.carBase[p], 0.1)),
      catchRate: by((p) => safe(this.rec[p], this.tgt[p], 0.65)),
      ypt: by((p) => safe(this.recYds[p], this.tgt[p], 7.5)),
      ypc: by((p) => safe(this.rushYds[p], this.car[p], 4.2)),
      qbAttShare: safe(this.qbAtt, this.qbTeamAtt, 0.95),
      cmpRate: safe(this.cmp, this.qbAtt, 0.63),
      ypa: safe(this.passYds, this.qbAtt, 7),
      teamTgt: safe(this.teamTgt, this.teamGames, 33),
      teamCar: safe(this.teamCar, this.teamGames, 26),
      teamAtt: safe(this.teamAtt, this.teamGames, 34),
    };
  }
}

export interface GameContext {
  gameId: string;
  home: string;
  /** Closing spread, home perspective (+ = home favored). */
  spread: number | null;
  total: number | null;
}

/** The identity a snapshot needs — a past `PlayerGame`, or an upcoming game's candidate with no outcome yet. */
export type PlayerGameKey = Pick<PlayerGame, "gameId" | "season" | "week" | "team" | "opp" | "playerId" | "name" | "position">;

/**
 * Mutable walk-forward state. `foldWeek` adds one week's outcomes; `snapshot`
 * reads the state as it stands — so the caller controls the as-of boundary:
 * snapshot a week's games first, fold that week second.
 */
export class PropState {
  private readonly playerAcc = new Map<string, Acc<(typeof PLAYER_KEYS)[number]>>();
  private readonly teamAcc = new Map<string, Acc<(typeof TEAM_KEYS)[number]>>();
  private readonly defAcc = new Map<string, Acc<(typeof DEF_KEYS)[number]>>();
  private readonly league = new League();
  private rates: LeagueRates | null = null;

  constructor(private readonly params: EngineParams) {}

  private get<K extends string>(m: Map<string, Acc<K>>, id: string, keys: readonly K[]): Acc<K> {
    return m.get(id) ?? m.set(id, new Acc(keys)).get(id)!;
  }

  snapshot(key: PlayerGameKey, ctx: GameContext | undefined, weekKey: string): Snapshot {
    this.rates ??= this.league.rates();
    const isHome = ctx?.home === key.team;
    // A played game passes through by identity (callers key maps on it); an upcoming one gets zeroed outcomes.
    const pg: PlayerGame =
      "targets" in key
        ? (key as PlayerGame)
        : {
            ...key,
            offenseSnaps: 0, offensePct: 0, targets: 0, receptions: 0, receivingYards: 0, carries: 0, rushingYards: 0,
            passAttempts: 0, completions: 0, passingYards: 0,
          };
    return {
      pg,
      weekKey,
      teamSpread: ctx?.spread == null ? null : isHome ? ctx.spread : -ctx.spread,
      total: ctx?.total ?? null,
      player: this.get(this.playerAcc, key.playerId, PLAYER_KEYS).snapshot(),
      team: this.get(this.teamAcc, key.team, TEAM_KEYS).snapshot(),
      oppDef: this.get(this.defAcc, key.opp, DEF_KEYS).snapshot(),
      league: this.rates,
    };
  }

  foldWeek(wkPlayers: readonly PlayerGame[], wkTeams: readonly TeamGameVolume[], teamGame: ReadonlyMap<string, TeamGameVolume>): void {
    const params = this.params;
    for (const t of wkTeams) {
      this.get(this.teamAcc, t.team, TEAM_KEYS).add(t.season, { games: 1, tgt: t.targets, car: t.carries, att: t.passAttempts }, params);
      this.league.addTeam(t);
    }
    const defWeek = new Map<string, Partial<DefSums> & { season: number }>();
    for (const t of wkTeams) defWeek.set(t.opp, { season: t.season, games: 1, tgtA: t.targets, carA: t.carries, attA: t.passAttempts });
    for (const pg of wkPlayers) {
      const tv = teamGame.get(`${pg.gameId}|${pg.team}`);
      if (!tv) continue;
      this.get(this.playerAcc, pg.playerId, PLAYER_KEYS).add(
        pg.season,
        {
          games: 1, snapPct: pg.offensePct,
          tgt: pg.targets, teamTgt: tv.targets, rec: pg.receptions, recYds: pg.receivingYards,
          car: pg.carries, teamCar: tv.carries, rushYds: pg.rushingYards,
          att: pg.passAttempts, teamAtt: tv.passAttempts, cmp: pg.completions, passYds: pg.passingYards,
        },
        params
      );
      this.league.addPlayer(pg, tv);
      const d = defWeek.get(pg.opp);
      if (!d) continue;
      const add = (k: keyof DefSums, v: number) => (d[k] = (d[k] ?? 0) + v);
      if (pg.position !== "QB") {
        const pos = pg.position;
        add(`tgt${pos}`, pg.targets);
        add(`rec${pos}`, pg.receptions);
        add(`yds${pos}`, pg.receivingYards);
      }
      add("rushCar", pg.carries);
      add("rushYds", pg.rushingYards);
      add("passAtt", pg.passAttempts);
      add("passCmp", pg.completions);
      add("passYds", pg.passingYards);
    }
    for (const [def, d] of defWeek) this.get(this.defAcc, def, DEF_KEYS).add(d.season, d, params);
    this.rates = null;
  }
}

export const weekKeyOf = (season: number, week: number) => `${season}_${String(week).padStart(2, "0")}`;

/**
 * Walk every week in order; `emit` receives each played player-game's
 * pre-week snapshot. Returns the final state (every week folded in), from
 * which upcoming games can be snapshotted.
 */
export function walkForward(
  players: readonly PlayerGame[],
  teams: readonly TeamGameVolume[],
  games: ReadonlyMap<string, GameContext>,
  params: EngineParams,
  emit: (s: Snapshot) => void
): PropState {
  const playersByWeek = new Map<string, PlayerGame[]>();
  for (const p of players) {
    const k = weekKeyOf(p.season, p.week);
    (playersByWeek.get(k) ?? playersByWeek.set(k, []).get(k)!).push(p);
  }
  const teamsByWeek = new Map<string, TeamGameVolume[]>();
  for (const t of teams) {
    const k = weekKeyOf(t.season, t.week);
    (teamsByWeek.get(k) ?? teamsByWeek.set(k, []).get(k)!).push(t);
  }
  const teamGame = new Map(teams.map((t) => [`${t.gameId}|${t.team}`, t]));
  const state = new PropState(params);
  const weeks = [...new Set([...playersByWeek.keys(), ...teamsByWeek.keys()])].sort();
  for (const wk of weeks) {
    const wkPlayers = playersByWeek.get(wk) ?? [];
    for (const pg of wkPlayers) emit(state.snapshot(pg, games.get(pg.gameId), wk));
    state.foldWeek(wkPlayers, teamsByWeek.get(wk) ?? [], teamGame);
  }
  return state;
}
