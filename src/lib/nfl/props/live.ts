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
import { loadFrozenModel, medianLongest, type PricingAux, type ServedMarket } from "./frozen";
import { KickerTracker, fgLambda, firstTdProbability, kickingPointsMean } from "./batchB";
import { loadKickerGames, kickingPoints, type KickerGame } from "./kickerGames";
import { loadSeasonPlayExtras, type PlayerGameLongest } from "../pbp/playExtras";
import { impliedTeamPoints } from "./td";
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
  /** Pricing inputs for longest-play markets (see `PricingAux`). */
  aux?: PricingAux;
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

/**
 * nflverse weekly roster for the target week (or the latest published week before it), keyed by GSIS id.
 * Returns null — with a warning — if no roster for the season is available, so projections still run.
 */
async function weeklyRoster(season: number, week: number, warnings: string[]): Promise<Map<string, { team: string; status: string }> | null> {
  const rows = await loadReleaseCsv("weekly_rosters", `roster_weekly_${season}.csv.gz`, ["week", "team", "gsis_id", "status", "game_type"] as const);
  const reg = (rows ?? []).filter((r) => r.game_type === "REG" && Number(r.week) <= week && r.gsis_id);
  if (reg.length === 0) {
    warnings.push(`No ${season} weekly roster published — roster-status filtering skipped.`);
    return null;
  }
  const useWeek = Math.max(...reg.map((r) => Number(r.week)));
  if (useWeek !== week) warnings.push(`Week ${week} roster not published yet — using week ${useWeek} roster statuses.`);
  return new Map(reg.filter((r) => Number(r.week) === useWeek).map((r) => [r.gsis_id, { team: franchise(r.team), status: r.status }]));
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

  // v1.4 inputs: longest plays (this season + last) and kickers (full history for the tracker)
  const bb = model.file.batchB;
  const longest = new Map<string, PlayerGameLongest>();
  const kickerHistory = new Map<string, KickerGame[]>();
  const kickerTracker = bb ? new KickerTracker(bb.kick.params.halfLife, bb.kick.params.priorGames) : null;
  const firstTdScorer = new Map<string, string | null>();
  if (bb) {
    for (const s of [season - 1, season]) {
      try {
        const x = await loadSeasonPlayExtras(s);
        for (const l of x.longest) longest.set(`${l.gameId}|${l.playerId}`, l);
        for (const f of x.firstTds) firstTdScorer.set(f.gameId, f.playerId);
      } catch {
        warnings.push(`play-by-play for ${s} unavailable — longest-play season averages may be missing`);
      }
    }
    const kickers = (await loadKickerGames(FIRST_SEASON, season)).filter((k) => k.season < season || k.week < week);
    const kWeeks = new Map<string, KickerGame[]>();
    for (const k of kickers) (kWeeks.get(`${k.season}_${String(k.week).padStart(2, "0")}`) ?? kWeeks.set(`${k.season}_${String(k.week).padStart(2, "0")}`, []).get(`${k.season}_${String(k.week).padStart(2, "0")}`)!).push(k);
    for (const wk of [...kWeeks.keys()].sort()) {
      kickerTracker!.fold(kWeeks.get(wk)!);
      for (const k of kWeeks.get(wk)!) (kickerHistory.get(k.playerId) ?? kickerHistory.set(k.playerId, []).get(k.playerId)!).push(k);
    }
  }

  // 2. candidates
  const injuryIndex = opts.injuryIndex ?? (await loadInjuryReports(season, season));
  const injuries = new Map((injuryIndex.get(`${season}|${week}`) ?? []).map((e) => [e.playerId, e.status as string]));
  const headshots = new Map(
    ((await loadReleaseCsv("players", "players.csv", ["gsis_id", "headshot"] as const)) ?? []).filter((p) => p.headshot && p.headshot !== "NA").map((p) => [p.gsis_id, p.headshot])
  );
  // Current roster status: a player's last game being for a team doesn't mean he's still there. Injured-reserve
  // players aren't on the weekly injury report, and cut players aren't anywhere. Require ACT on this week's roster.
  const roster = await weeklyRoster(season, week, warnings);
  const rosterBlock = (playerId: string): string | null => {
    if (!roster) return null;
    const r = roster.get(playerId);
    if (!r) return "Not on a current roster";
    return r.status === "ACT" ? null : `Roster status: ${r.status}`;
  };
  /** The team a player is on now: his current roster team, else the team of his last game. */
  const currentTeam = (playerId: string, lastTeam: string) => roster?.get(playerId)?.team ?? lastTeam;
  const teamGameMap = new Map<string, UpcomingGame>();
  for (const g of games) {
    teamGameMap.set(g.home, g);
    teamGameMap.set(g.away, g);
  }
  const rows: PropProjectionRow[] = [];
  const excluded: LiveProjection["excluded"] = [];
  for (const playerId of [...tracker.players()]) {
    const lastPlayed = tracker.lastGame(playerId)!;
    if (lastPlayed.season < season - 1) continue;
    // A player who changed teams is projected for his new team, carrying his own usage history
    // (the validated population includes team changers the same way).
    const last = { ...lastPlayed, team: currentTeam(playerId, lastPlayed.team) };
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
    const blocked = rosterBlock(playerId);
    if (blocked) {
      excluded.push({ name: last.name, team: last.team, reason: blocked });
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

    // v1.4: longest plays and first TD scorer
    if (bb) {
      const cur = v.history.filter((g) => g.season === season);
      const ref = cur.length ? cur : v.history.filter((g) => g.season === season - 1);
      const l5 = v.history.slice(-5);
      const longestOf = (g: PlayerGame, f: (l: PlayerGameLongest) => number) => {
        const l = longest.get(`${g.gameId}|${g.playerId}`);
        return l ? f(l) : 0;
      };
      const rateL = (gs: readonly PlayerGame[], f: (l: PlayerGameLongest) => number) => {
        // only games whose play-by-play we loaded count toward the average
        const known = gs.filter((g) => g.season >= season - 1);
        return known.length ? known.reduce((acc, g) => acc + longestOf(g, f), 0) / known.length : null;
      };
      const defs = [
        { market: "longestReception" as const, fam: "rec" as const, touches: v.proj.receptions, ypp: v.base.catchRate > 0 ? v.base.ypt / v.base.catchRate : 0, f: (l: PlayerGameLongest) => l.longestReception, label: "receptions", yppLabel: "yds / catch" },
        { market: "longestRush" as const, fam: "rush" as const, touches: v.proj.rushAttempts, ypp: v.base.ypc, f: (l: PlayerGameLongest) => l.longestRush, label: "carries", yppLabel: "yds / carry" },
        { market: "longestCompletion" as const, fam: "pass" as const, touches: v.proj.completions, ypp: v.base.cmpRate > 0 ? v.base.ypa / v.base.cmpRate : 0, f: (l: PlayerGameLongest) => l.longestCompletion, label: "completions", yppLabel: "yds / completion" },
      ];
      for (const d of defs) {
        if (!families.includes(d.fam)) continue;
        const aux: PricingAux = { touches: d.touches, ypp: d.ypp, position: last.position };
        rows.push({
          ...common,
          market: d.market,
          mean: medianLongest(model, d.market, aux),
          breakdown: { teamVolume: d.touches, share: 0, efficiency: d.ypp, oppFactor: null, volumeLabel: d.label, efficiencyLabel: d.yppLabel },
          seasonAvg: rateL(ref, d.f),
          l5Avg: rateL(l5, d.f),
          availabilityNote: null,
          aux,
        });
      }
      if (v.td && (families.includes("rec") || families.includes("rush"))) {
        const oppTds = replayer.teamView(opp, last.team, game.gameId, season, week, ctx.get(game.gameId)).teamTds ?? 2.4;
        const gameLam = v.td.teamTds + oppTds + bb.firstTd.delta;
        const firsts = (gs: readonly PlayerGame[]) => {
          const known = gs.filter((g) => g.season >= season - 1);
          return known.length ? known.filter((g) => firstTdScorer.get(g.gameId) === g.playerId).length / known.length : null;
        };
        rows.push({
          ...common,
          market: "firstTd",
          mean: firstTdProbability(v.td.anytimeLambda, gameLam),
          breakdown: { teamVolume: gameLam, share: v.td.anytimeLambda / gameLam, efficiency: null, oppFactor: null, volumeLabel: "game TDs", efficiencyLabel: null },
          seasonAvg: firsts(ref),
          l5Avg: firsts(l5),
          availabilityNote: null,
        });
      }
    }
  }

  // v1.4 kickers: last game for a team playing this week, ≥2 prior games, not ruled out
  if (bb && kickerTracker) {
    for (const [kid, hist] of kickerHistory) {
      const lastKick = hist[hist.length - 1];
      if (hist.length < 2 || lastKick.season < season - 1) continue;
      const last = { ...lastKick, team: currentTeam(kid, lastKick.team) };
      const game = teamGameMap.get(last.team);
      if (!game) continue;
      const status = injuries.get(kid);
      if (status === "Out" || status === "Doubtful") {
        excluded.push({ name: last.name, team: last.team, reason: `Injury report: ${status}` });
        continue;
      }
      const blocked = rosterBlock(kid);
      if (blocked) {
        excluded.push({ name: last.name, team: last.team, reason: blocked });
        continue;
      }
      const opp = game.home === last.team ? game.away : game.home;
      const tv = replayer.teamView(last.team, opp, game.gameId, season, week, ctx.get(game.gameId));
      const teamTds = tv.teamTds ?? 2.4;
      const implied = impliedTeamPoints(tv.snap);
      const recent = kickerTracker.recentFgm(kid);
      const lam = fgLambda(bb.kick.params, implied, teamTds, recent);
      const cur = hist.filter((g) => g.season === season);
      const ref = cur.length ? cur : hist.filter((g) => g.season === season - 1);
      const l5 = hist.slice(-5);
      const avgK = (gs: readonly KickerGame[], f: (g: KickerGame) => number) => (gs.length ? gs.reduce((acc, g) => acc + f(g), 0) / gs.length : null);
      const common = {
        game, playerId: kid, name: last.name, position: "K", headshotUrl: headshots.get(kid) ?? null, team: last.team, opp,
        priorGames: hist.length, injury: (status === "Questionable" ? "Questionable" : null) as InjuryStatus, availabilityNote: null,
      };
      rows.push({
        ...common,
        market: "fgMade",
        mean: lam,
        breakdown: {
          teamVolume: 0, share: 0, efficiency: null, oppFactor: null, volumeLabel: "", efficiencyLabel: null,
          parts: [{ label: "implied pts", value: implied }, { label: "team TDs", value: teamTds }, { label: "recent FGM", value: recent }],
        },
        seasonAvg: avgK(ref, (g) => g.fgMade),
        l5Avg: avgK(l5, (g) => g.fgMade),
      });
      rows.push({
        ...common,
        market: "kickingPoints",
        mean: kickingPointsMean(bb.kick.params, lam, teamTds),
        breakdown: {
          teamVolume: 0, share: 0, efficiency: null, oppFactor: null, volumeLabel: "", efficiencyLabel: null,
          parts: [{ label: "3 × exp. FGs", value: 3 * lam }, { label: "exp. XPs", value: bb.kick.params.xpPerTd * teamTds }],
        },
        seasonAvg: avgK(ref, kickingPoints),
        l5Avg: avgK(l5, kickingPoints),
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
