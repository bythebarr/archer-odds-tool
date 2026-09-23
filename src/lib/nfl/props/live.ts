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
import { MARKET_FAMILY, type Baseline, type PropFamily } from "./eligibility";
import { loadInjuryReports, type InjuryIndex } from "./injuries";
import type { GameContext, PlayerGameKey } from "./engine";
import { loadFrozenModel, type ServedMarket } from "./frozen";
import { PROP_MARKETS, type PropMarket } from "./model";
import { PropReplayer, groupWeeks } from "./replay";
import { interceptionLambda, intRate, oppIntFactor } from "./extras";
import { loadPlayerGames, type PlayerGame } from "./playerGames";

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
  market: ServedMarket;
  /** Projected mean; for touchdown markets, the Poisson rate λ (expected TDs). */
  mean: number;
  /** Named pieces of the projection — presentation data, computed here so the UI carries no model logic. */
  breakdown: {
    teamVolume: number;
    share: number;
    efficiency: number | null;
    oppFactor: number | null;
    volumeLabel: string;
    efficiencyLabel: string | null;
    /** For combo markets: the component projections that sum to the mean. */
    parts?: { label: string; value: number }[];
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

  // 1. replay every completed week through the shared replayer (no views needed for history)
  const ctx = new Map<string, GameContext>(allGames.map((g) => [g.gameId, { gameId: g.gameId, home: franchise(g.home), spread: g.spreadLine, total: g.totalLine }]));
  const replayer = new PropReplayer(model.file);
  const { weeks, byWeek, teamsByWeek, teamGame } = groupWeeks(completed, completedTeams);
  for (const wk of weeks) replayer.foldWeek(byWeek.get(wk) ?? [], teamsByWeek.get(wk) ?? [], teamGame);
  const tracker = replayer.tracker;

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
  for (const playerId of [...tracker.players()]) {
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
    const v = replayer.view(key, ctx.get(game.gameId), injuryIndex);
    const { c, teamTgt, teamCar, teamAtt } = v.adj;
    const f = v.opp;
    const vol = { rec: teamTgt, rush: teamCar, pass: teamAtt };
    const a = model.file.params.availability;
    const carNote =
      a && (a.carSame !== 0 || a.carOther !== 0)
        ? v.avail.absent.filter((x) => x.vacCar >= 0.02 && x.name !== last.name).map((x) => `${x.name} (${x.position}) out`)
        : [];
    const common = {
      game, playerId, name: last.name, position: last.position, headshotUrl: headshots.get(playerId) ?? null, team: last.team, opp,
      priorGames: baseline.priorGames, injury: (status === "Questionable" ? "Questionable" : null) as InjuryStatus,
    };
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
        ...common,
        market,
        mean: v.proj[market],
        breakdown: { teamVolume: vol[fam], share, efficiency, oppFactor, volumeLabel: VOLUME_LABEL[fam], efficiencyLabel },
        seasonAvg: baseline.seasonAvg?.[market] ?? null,
        l5Avg: baseline.l5Avg?.[market] ?? null,
        availabilityNote: fam === "rush" && carNote.length ? carNote.join(", ") : null,
      });
    }

    // v1.2 touchdown markets — same eligibility; λ from market-implied team TDs × shrunk TD share
    if (v.td) {
      const history = tracker.gamesOf(playerId);
      const cur = history.filter((g) => g.season === season);
      const ref = cur.length ? cur : history.filter((g) => g.season === season - 1);
      const l5 = history.slice(-5);
      const rate = (gs: readonly PlayerGame[], fn: (g: PlayerGame) => number) => (gs.length ? gs.reduce((acc, g) => acc + fn(g), 0) / gs.length : null);
      const anyTd = (g: PlayerGame) => (g.rushingTds + g.receivingTds > 0 ? 1 : 0);
      if (families.includes("rec") || families.includes("rush")) {
        rows.push({
          ...common,
          market: "anytimeTd",
          mean: v.td.anytimeLambda,
          breakdown: { teamVolume: v.td.teamTds, share: v.td.share, efficiency: null, oppFactor: null, volumeLabel: "team TDs", efficiencyLabel: null },
          seasonAvg: rate(ref, anyTd),
          l5Avg: rate(l5, anyTd),
          availabilityNote: null,
        });
      }
      if (families.includes("pass")) {
        rows.push({
          ...common,
          market: "passingTds",
          mean: v.td.passLambda,
          breakdown: { teamVolume: v.td.teamTds * v.td.passFrac, share: v.base.attShare, efficiency: null, oppFactor: null, volumeLabel: "team pass TDs", efficiencyLabel: null },
          seasonAvg: rate(ref, (g) => g.passingTds),
          l5Avg: rate(l5, (g) => g.passingTds),
          availabilityNote: null,
        });
      }
    }

    // v1.3 markets: combos (sum of marginals, own distribution), interceptions, 2+ TDs
    const ex = model.file.extras;
    if (ex) {
      const history = v.history;
      const cur = history.filter((g) => g.season === season);
      const ref = cur.length ? cur : history.filter((g) => g.season === season - 1);
      const l5 = history.slice(-5);
      const rate = (gs: readonly PlayerGame[], fn: (g: PlayerGame) => number) => (gs.length ? gs.reduce((acc, g) => acc + fn(g), 0) / gs.length : null);
      const noEff = { efficiency: null, oppFactor: null, efficiencyLabel: null };
      if (last.position !== "QB" && (families.includes("rec") || families.includes("rush"))) {
        rows.push({
          ...common,
          market: "rushRecYards",
          mean: v.proj.rushingYards + v.proj.receivingYards,
          breakdown: {
            teamVolume: 0, share: 0, volumeLabel: "", ...noEff,
            parts: [{ label: "rush yds", value: v.proj.rushingYards }, { label: "rec yds", value: v.proj.receivingYards }],
          },
          seasonAvg: rate(ref, (g) => g.rushingYards + g.receivingYards),
          l5Avg: rate(l5, (g) => g.rushingYards + g.receivingYards),
          availabilityNote: carNote.length ? carNote.join(", ") : null,
        });
      }
      if (families.includes("pass")) {
        rows.push({
          ...common,
          market: "passRushYards",
          mean: v.proj.passingYards + v.proj.rushingYards,
          breakdown: {
            teamVolume: 0, share: 0, volumeLabel: "", ...noEff,
            parts: [{ label: "pass yds", value: v.proj.passingYards }, { label: "rush yds", value: v.proj.rushingYards }],
          },
          seasonAvg: rate(ref, (g) => g.passingYards + g.rushingYards),
          l5Avg: rate(l5, (g) => g.passingYards + g.rushingYards),
          availabilityNote: null,
        });
        const p = ex.interceptions.params;
        rows.push({
          ...common,
          market: "interceptions",
          mean: interceptionLambda(v.proj.passAttempts, v.set.efficiency, v.set.defense, p),
          breakdown: {
            teamVolume: v.proj.passAttempts, share: intRate(v.set.efficiency, p), volumeLabel: "pass attempts",
            efficiency: null, oppFactor: oppIntFactor(v.set.defense, p), efficiencyLabel: null,
          },
          seasonAvg: rate(ref, (g) => g.interceptions),
          l5Avg: rate(l5, (g) => g.interceptions),
          availabilityNote: null,
        });
      }
      if (v.td && (families.includes("rec") || families.includes("rush"))) {
        const multi = (g: PlayerGame) => (g.rushingTds + g.receivingTds >= 2 ? 1 : 0);
        rows.push({
          ...common,
          market: "twoPlusTds",
          mean: v.td.anytimeLambda,
          breakdown: { teamVolume: v.td.teamTds, share: v.td.share, efficiency: null, oppFactor: null, volumeLabel: "team TDs", efficiencyLabel: null },
          seasonAvg: rate(ref, multi),
          l5Avg: rate(l5, multi),
          availabilityNote: null,
        });
      }
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
