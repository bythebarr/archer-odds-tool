/**
 * Projects the upcoming NFL week's player props with the frozen model. Offline
 * I/O (nflverse downloads into `.cache/`), so it runs from a script
 * (`npm run capture:nfl:props`), never inside a request; the app reads the
 * stored result.
 *
 * Pipeline, all as of now:
 *   1. Replay every completed regular-season game (2013 → last completed week)
 *      through one `PropState` per component group, with the frozen decay
 *      parameters, and through the shared `EligibilityTracker`.
 *   2. The target week = the earliest week of the current season with an
 *      unplayed game. Candidates = players whose most recent game was for a
 *      team playing that week, filtered by the same eligibility rules the
 *      model was validated under.
 *   3. The week's official injury report drops anyone listed Out or Doubtful
 *      and flags Questionable. Game-day inactives aren't known yet and aren't
 *      modeled.
 *   4. Project each (player, market) and keep the full breakdown (team
 *      volume × share × efficiency × opponent factor) for the UI.
 */
import { fetchNflGames, type NflGame } from "../games";
import { franchise } from "../pbp/franchise";
import { loadReleaseCsv, setInProgressSeason } from "../nflverse";
import { AvailabilityTracker, NO_ABSENCES } from "./availability";
import { EligibilityTracker, MARKET_FAMILY, type Baseline, type PropFamily } from "./eligibility";
import { loadInjuryReports, ruledOut, type InjuryIndex } from "./injuries";
import { PropState, weekKeyOf, type GameContext, type PlayerGameKey } from "./engine";
import { loadFrozenModel } from "./frozen";
import { PROP_MARKETS, adjusted, oppFactors, project, type PropMarket, type SnapshotSet } from "./model";
import { loadPlayerGames, type PlayerGame, type TeamGameVolume } from "./playerGames";

const FIRST_SEASON = 2013;

export interface UpcomingGame {
  gameId: string;
  espnId: string | null;
  kickoffUtc: Date | null;
  season: number;
  week: number;
  home: string;
  away: string;
  spread: number | null;
  total: number | null;
}

export type InjuryStatus = "Questionable" | null;

export interface PropProjectionRow {
  game: UpcomingGame;
  playerId: string;
  name: string;
  position: string;
  headshotUrl: string | null;
  team: string;
  opp: string;
  market: PropMarket;
  mean: number;
  /** Named pieces of the projection — presentation data, computed here so the UI carries no model logic. */
  breakdown: {
    teamVolume: number;
    share: number;
    efficiency: number | null;
    oppFactor: number | null;
    volumeLabel: string;
    efficiencyLabel: string | null;
  };
  seasonAvg: number | null;
  l5Avg: number | null;
  priorGames: number;
  injury: InjuryStatus;
  /** Ruled-out teammates whose usage this projection redistributes (v1.1: carries only), e.g. "J. Doe (RB) out". */
  availabilityNote: string | null;
}

export interface LiveProjection {
  season: number;
  week: number;
  games: UpcomingGame[];
  rows: PropProjectionRow[];
  excluded: { name: string; team: string; reason: string }[];
  dataAsOf: { lastCompletedWeek: string; statsThroughWeek: number | null };
  warnings: string[];
}

function upcomingWeek(all: readonly NflGame[], now: Date): UpcomingGame[] {
  const unplayed = all.filter((g) => g.gameType === "REG" && g.result === null && (g.kickoffUtc ?? g.date) >= new Date(now.getTime() - 6 * 3600_000));
  if (unplayed.length === 0) return [];
  const season = Math.min(...unplayed.map((g) => g.season));
  const week = Math.min(...unplayed.filter((g) => g.season === season).map((g) => g.week));
  return unplayed
    .filter((g) => g.season === season && g.week === week)
    .map((g) => ({
      gameId: g.gameId,
      espnId: g.espnId ?? null,
      kickoffUtc: g.kickoffUtc ?? null,
      season,
      week,
      home: franchise(g.home),
      away: franchise(g.away),
      spread: g.spreadLine,
      total: g.totalLine,
    }))
    .sort((a, b) => (a.kickoffUtc?.getTime() ?? 0) - (b.kickoffUtc?.getTime() ?? 0));
}

const VOLUME_LABEL: Record<PropFamily, string> = { rec: "team targets", rush: "team carries", pass: "team pass attempts" };

export async function projectUpcomingWeek(
  now = new Date(),
  log?: (msg: string) => void,
  /** Test/diagnostic hook: supply the injury report instead of downloading it. */
  opts: { injuryIndex?: InjuryIndex } = {}
): Promise<LiveProjection> {
  const model = loadFrozenModel();
  const { engine, params } = model.file;
  const allGames = await fetchNflGames();
  const games = upcomingWeek(allGames, now);
  if (games.length === 0) throw new Error("No upcoming regular-season NFL games found in nflverse schedule.");
  const { season, week } = games[0];
  const warnings: string[] = [];

  setInProgressSeason(season);
  const { players, teams } = await loadPlayerGames(FIRST_SEASON, season, log);
  const completed = players.filter((p) => p.season < season || p.week < week);
  const completedTeams = teams.filter((t) => t.season < season || t.week < week);
  const statsThroughWeek = Math.max(0, ...completed.filter((p) => p.season === season).map((p) => p.week)) || null;
  if (week > 1 && statsThroughWeek !== week - 1) {
    warnings.push(`nflverse box scores for ${season} run through week ${statsThroughWeek ?? 0}, but week ${week - 1} is complete — projections are missing the latest week.`);
  }

  // 1. replay history
  const ctx = new Map<string, GameContext>(allGames.map((g) => [g.gameId, { gameId: g.gameId, home: franchise(g.home), spread: g.spreadLine, total: g.totalLine }]));
  const states = {
    usage: new PropState(engine.usage),
    efficiency: new PropState(engine.efficiency),
    team: new PropState(engine.team),
    defense: new PropState(engine.defense),
  };
  const tracker = new EligibilityTracker();
  const availTracker = new AvailabilityTracker(engine.usage.halfLife);
  const byWeek = new Map<string, PlayerGame[]>();
  for (const p of completed) (byWeek.get(weekKeyOf(p.season, p.week)) ?? byWeek.set(weekKeyOf(p.season, p.week), []).get(weekKeyOf(p.season, p.week))!).push(p);
  const teamsByWeek = new Map<string, TeamGameVolume[]>();
  for (const t of completedTeams) (teamsByWeek.get(weekKeyOf(t.season, t.week)) ?? teamsByWeek.set(weekKeyOf(t.season, t.week), []).get(weekKeyOf(t.season, t.week))!).push(t);
  const teamGame = new Map(completedTeams.map((t) => [`${t.gameId}|${t.team}`, t]));
  const weeks = [...new Set([...byWeek.keys(), ...teamsByWeek.keys()])].sort();
  for (const wk of weeks) {
    const wp = byWeek.get(wk) ?? [];
    const wt = teamsByWeek.get(wk) ?? [];
    for (const s of Object.values(states)) s.foldWeek(wp, wt, teamGame);
    tracker.foldWeek(wp);
    availTracker.foldWeek(wp);
  }

  // 2. candidates
  const injuryIndex = opts.injuryIndex ?? (await loadInjuryReports(season, season));
  const injuries = new Map((injuryIndex.get(`${season}|${week}`) ?? []).map((e) => [e.playerId, e.status as string]));
  const headshots = new Map(
    ((await loadReleaseCsv("players", "players.csv", ["gsis_id", "headshot"] as const)) ?? []).filter((p) => p.headshot && p.headshot !== "NA").map((p) => [p.gsis_id, p.headshot])
  );
  const teamGameMap = new Map<string, UpcomingGame>();
  for (const g of games) {
    teamGameMap.set(g.home, g);
    teamGameMap.set(g.away, g);
  }
  const rows: PropProjectionRow[] = [];
  const excluded: LiveProjection["excluded"] = [];
  const upcomingKey = weekKeyOf(season, week);
  const availCache = new Map<string, ReturnType<AvailabilityTracker["context"]>>();
  const teamAvail = (team: string, game: UpcomingGame, opp: string) => {
    const hit = availCache.get(team);
    if (hit) return hit;
    const out = ruledOut(injuryIndex, season, week, team);
    const ctxA = out.length
      ? availTracker.context(team, { gameId: game.gameId, season, week, opp }, out, states.usage, params.shrink, tracker.leadPasser(team))
      : NO_ABSENCES;
    availCache.set(team, ctxA);
    return ctxA;
  };
  for (const playerId of tracker.players()) {
    const last = tracker.lastGame(playerId)!;
    if (last.season < season - 1) continue;
    const game = teamGameMap.get(last.team);
    if (!game) continue;
    const opp = game.home === last.team ? game.away : game.home;
    const key: PlayerGameKey = { gameId: game.gameId, season, week, team: last.team, opp, playerId, name: last.name, position: last.position };
    const baseline: Baseline = tracker.baseline(key);
    const families = (Object.keys(baseline.eligible) as PropFamily[]).filter((f) => baseline.eligible[f]);
    if (families.length === 0) continue;
    const status = injuries.get(playerId);
    if (status === "Out" || status === "Doubtful") {
      excluded.push({ name: last.name, team: last.team, reason: `Injury report: ${status}` });
      continue;
    }

    // 3. project
    const gctx = ctx.get(game.gameId);
    const set: SnapshotSet = {
      usage: states.usage.snapshot(key, gctx, upcomingKey),
      efficiency: states.efficiency.snapshot(key, gctx, upcomingKey),
      team: states.team.snapshot(key, gctx, upcomingKey),
      defense: states.defense.snapshot(key, gctx, upcomingKey),
    };
    const avail = teamAvail(last.team, game, opp);
    const p = project(set, params, avail);
    const { c, teamTgt, teamCar, teamAtt } = adjusted(set, params, avail);
    const f = oppFactors(set.defense, params.opp);
    const vol = { rec: teamTgt, rush: teamCar, pass: teamAtt };
    const a = params.availability;
    const carNote =
      a && (a.carSame !== 0 || a.carOther !== 0)
        ? avail.absent.filter((x) => x.vacCar >= 0.02 && x.name !== last.name).map((x) => `${x.name} (${x.position}) out`)
        : [];
    for (const market of PROP_MARKETS) {
      const fam = MARKET_FAMILY[market];
      if (!families.includes(fam)) continue;
      const share = fam === "rec" ? c.tgtShare : fam === "rush" ? c.carShare : c.attShare;
      const eff: Record<PropMarket, [number | null, number | null, string | null]> = {
        receptions: [c.catchRate, null, "catch rate"],
        receivingYards: [c.ypt, f.rec, "yards / target"],
        rushAttempts: [null, null, null],
        rushingYards: [c.ypc, f.rush, "yards / carry"],
        passAttempts: [null, null, null],
        completions: [c.cmpRate, null, "completion rate"],
        passingYards: [c.ypa, f.pass, "yards / attempt"],
      };
      const [efficiency, oppFactor, efficiencyLabel] = eff[market];
      rows.push({
        game,
        playerId,
        name: last.name,
        position: last.position,
        headshotUrl: headshots.get(playerId) ?? null,
        team: last.team,
        opp,
        market,
        mean: p[market],
        breakdown: { teamVolume: vol[fam], share, efficiency, oppFactor, volumeLabel: VOLUME_LABEL[fam], efficiencyLabel },
        seasonAvg: baseline.seasonAvg?.[market] ?? null,
        l5Avg: baseline.l5Avg?.[market] ?? null,
        priorGames: baseline.priorGames,
        injury: status === "Questionable" ? "Questionable" : null,
        availabilityNote: fam === "rush" && carNote.length ? carNote.join(", ") : null,
      });
    }
  }

  return {
    season,
    week,
    games,
    rows,
    excluded,
    dataAsOf: { lastCompletedWeek: weeks[weeks.length - 1] ?? "", statsThroughWeek },
    warnings,
  };
}
