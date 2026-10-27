/**
 * ARCHR's game-line model for one NBA or NFL game: ratings replayed over every
 * finished game, tonight's rest and injuries, the score distribution, and each
 * market priced against the books (see lib/gameModel).
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import {
  GAME_MODEL_BY_SPORT,
  PointsRatings,
  adjustExpected,
  fairSpread,
  fairTotal,
  keyWeights,
  nbaPlayerImpact,
  NFL_QB_IMPACT,
  NFL_SKILL_CAP,
  NFL_SKILL_IMPACT,
  pHomeWin,
  priceGameMarket,
  restEdge,
  scoreDist,
  statusWeight,
  type ExpectedScore,
  type MissingPlayer,
  type PricedMarket,
} from "@/lib/gameModel";
import { quotesFor } from "@/lib/gameModel/quotes";
import { PERIOD_SPECS, type Period, type PeriodSpec } from "@/lib/gameModel/markets";
import { injuryLevel } from "@/lib/injuries/status";
import { getModelWeights } from "./modelWeights";
import { MIN_FIT_SAMPLES } from "@/lib/propModel/market";
import type { GameLineRow } from "./games";

type Sport = "nba" | "nfl";

export interface TeamRead {
  name: string;
  abbreviation: string;
  /** Points per game better than average on a neutral floor. */
  net: number;
  offense: number;
  defense: number;
  games: number;
  restDays: number | null;
  restEdge: number;
  missing: MissingPlayer[];
  /** This season so far. */
  record: { w: number; l: number };
  last10: { w: number; l: number };
  /** Points per game scored and allowed this season (null before any game). */
  ppg: number | null;
  oppg: number | null;
}

/** A team's season so far: record, last ten, and points for and against per game. */
async function teamForm(sport: Sport, teamId: string, season: number, before: Date) {
  const games = await prisma.game.findMany({
    where: { sport, season, status: "final", scheduledStartUtc: { lt: before }, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
    orderBy: { scheduledStartUtc: "desc" },
    select: { homeTeamId: true, homeScore: true, awayScore: true },
  });
  const rows = games.flatMap((g) =>
    g.homeScore === null || g.awayScore === null
      ? []
      : [g.homeTeamId === teamId ? { pf: g.homeScore, pa: g.awayScore } : { pf: g.awayScore, pa: g.homeScore }]
  );
  const wl = (list: typeof rows) => ({ w: list.filter((r) => r.pf > r.pa).length, l: list.filter((r) => r.pf < r.pa).length });
  const avg = (f: (r: (typeof rows)[number]) => number) => (rows.length ? rows.reduce((a, r) => a + f(r), 0) / rows.length : null);
  return { record: wl(rows), last10: wl(rows.slice(0, 10)), ppg: avg((r) => r.pf), oppg: avg((r) => r.pa) };
}

export interface GameModelView {
  sport: Sport;
  /** Ratings-only expectation, before rest and injuries. */
  base: ExpectedScore;
  expected: ExpectedScore;
  hfa: number;
  home: TeamRead;
  away: TeamRead;
  pHomeWin: number;
  fairSpread: number;
  fairTotal: number;
  markets: PricedMarket[];
  marginSd: number;
  totalSd: number;
  /** Period shares and spreads: fitted from period scores once there are enough, else priors. */
  periodSpecs: Record<Exclude<Period, "game">, PeriodSpec>;
  /** The fitted model-vs-market weights (absent → default). */
  weights: Partial<Record<"ml" | "spread" | "total", number>>;
}

/** Every finished game for the league, replayed through the ratings once per request. */
const replay = cache(async (sport: Sport) => {
  const league = GAME_MODEL_BY_SPORT[sport];
  const games = await prisma.game.findMany({
    where: { sport, status: "final", homeScore: { not: null }, awayScore: { not: null }, homeTeamId: { not: null }, awayTeamId: { not: null } },
    orderBy: { scheduledStartUtc: "asc" },
    select: { homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true, season: true },
  });
  const ratings = new PointsRatings(league.ratings);
  for (const g of games) {
    ratings.touch(g.homeTeamId!, g.season);
    ratings.touch(g.awayTeamId!, g.season);
    ratings.update(g.homeTeamId!, g.awayTeamId!, g.homeScore!, g.awayScore!);
  }
  return ratings;
});

/** The fitted margin/total spreads (and period splits) from the latest games backtest, when it has enough games. */
async function fittedSpreads(
  sport: Sport
): Promise<{ marginSd: number; totalSd: number; periods: Record<Exclude<Period, "game">, PeriodSpec> | null } | null> {
  const r = await prisma.modelReport.findFirst({ where: { model: `${sport}-games:spread` }, orderBy: { createdAt: "desc" }, select: { n: true, extra: true } });
  const e = r?.extra as { marginSd?: number; totalSd?: number; periods?: Record<string, PeriodSpec & { n: number }> | null } | null | undefined;
  if (!r || r.n < MIN_FIT_SAMPLES || !e?.marginSd || !e?.totalSd) return null;
  const p = e.periods;
  const periods = p && ["h1", "h2", "q1", "q2", "q3", "q4"].every((k) => p[k] && p[k].n >= MIN_FIT_SAMPLES) ? (p as Record<Exclude<Period, "game">, PeriodSpec>) : null;
  return { marginSd: e.marginSd, totalSd: e.totalSd, periods };
}

async function daysSincePrevious(sport: Sport, teamId: string, start: Date): Promise<number | null> {
  const prev = await prisma.game.findFirst({
    where: { sport, scheduledStartUtc: { lt: start }, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
    orderBy: { scheduledStartUtc: "desc" },
    select: { scheduledStartUtc: true },
  });
  if (!prev) return null;
  const days = Math.round((start.getTime() - prev.scheduledStartUtc.getTime()) / 86_400_000);
  return days > 30 ? null : days; // a season break isn't rest
}

async function nbaMissing(teamId: string, teamName: string): Promise<MissingPlayer[]> {
  const injuries = await prisma.playerInjury.findMany({ where: { sport: "nba", teamName } });
  const out: MissingPlayer[] = [];
  for (const i of injuries) {
    const w = statusWeight(injuryLevel(i.status));
    if (w === 0) continue;
    const p = await prisma.nbaPlayer.findUnique({
      where: { espnAthleteId: i.espnAthleteId },
      include: { gameLogs: { where: { teamId }, orderBy: { gameDate: "desc" }, take: 15 } },
    });
    if (!p) continue;
    const impact = nbaPlayerImpact(p.gameLogs) * w;
    if (impact >= 0.3) out.push({ name: p.fullName, status: i.status, impact });
  }
  return out.sort((a, b) => b.impact - a.impact);
}

async function nflMissing(teamId: string, teamName: string): Promise<MissingPlayer[]> {
  const injuries = await prisma.playerInjury.findMany({ where: { sport: "nfl", teamName } });
  if (injuries.length === 0) return [];
  // The team's last three games: who threw, and who touched the ball.
  const recent = await prisma.game.findMany({
    where: { sport: "nfl", status: "final", OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
    orderBy: { scheduledStartUtc: "desc" },
    take: 3,
    select: { id: true },
  });
  const logs = await prisma.nflPlayerGameLog.findMany({
    where: { teamId, gameId: { in: recent.map((g) => g.id) } },
    include: { nflPlayer: { select: { espnAthleteId: true, fullName: true } } },
  });
  const by = new Map<string, { name: string; att: number; use: number }>();
  let teamAtt = 0;
  let teamUse = 0;
  for (const l of logs) {
    const row = by.get(l.nflPlayer.espnAthleteId) ?? { name: l.nflPlayer.fullName, att: 0, use: 0 };
    row.att += l.passAttempts;
    row.use += l.rushAttempts + l.targets;
    teamAtt += l.passAttempts;
    teamUse += l.rushAttempts + l.targets;
    by.set(l.nflPlayer.espnAthleteId, row);
  }
  const out: MissingPlayer[] = [];
  let skill = 0;
  for (const i of injuries) {
    const w = statusWeight(injuryLevel(i.status));
    const r = by.get(i.espnAthleteId);
    if (w === 0 || !r) continue;
    if (teamAtt > 0 && r.att / teamAtt >= 0.6) out.push({ name: r.name, status: i.status, impact: NFL_QB_IMPACT * w });
    else if (teamUse > 0 && r.use / teamUse >= 0.15 && skill < NFL_SKILL_CAP) {
      const impact = Math.min(NFL_SKILL_IMPACT * w, NFL_SKILL_CAP - skill);
      skill += impact;
      out.push({ name: r.name, status: i.status, impact });
    }
  }
  return out.sort((a, b) => b.impact - a.impact);
}

export async function getGameModelView(sport: Sport, gameId: string, lines: GameLineRow[]): Promise<GameModelView | null> {
  const league = GAME_MODEL_BY_SPORT[sport];
  const game = await prisma.game.findUnique({ where: { id: gameId }, include: { homeTeam: true, awayTeam: true } });
  if (!game?.homeTeam || !game.awayTeam) return null;
  const ratings = await replay(sport);
  const h = game.homeTeam.id;
  const a = game.awayTeam.id;
  if (ratings.games(h) < league.minGames || ratings.games(a) < league.minGames) return null;
  ratings.touch(h, game.season);
  ratings.touch(a, game.season);

  const [homeForm, awayForm] = await Promise.all([teamForm(sport, h, game.season, game.scheduledStartUtc), teamForm(sport, a, game.season, game.scheduledStartUtc)]);
  const [homeDays, awayDays, homeMissing, awayMissing, weights, fitted] = await Promise.all([
    daysSincePrevious(sport, h, game.scheduledStartUtc),
    daysSincePrevious(sport, a, game.scheduledStartUtc),
    sport === "nba" ? nbaMissing(h, game.homeTeam.name) : nflMissing(h, game.homeTeam.name),
    sport === "nba" ? nbaMissing(a, game.awayTeam.name) : nflMissing(a, game.awayTeam.name),
    getModelWeights(sport),
    fittedSpreads(sport),
  ]);
  const base = ratings.expected(h, a);
  const rest = restEdge(sport, { homeDays, awayDays });
  const expected = adjustExpected(base, rest, { home: homeMissing, away: awayMissing });
  const marginSd = fitted?.marginSd ?? league.marginSd;
  const totalSd = fitted?.totalSd ?? league.totalSd;
  const dist = scoreDist(expected, marginSd, totalSd, league.keyNumbers ? keyWeights(league.keyNumbers, marginSd) : undefined, league.ties);

  const markets = (["spread", "total", "ml"] as const).flatMap((m) => {
    const q = quotesFor(lines, m);
    const priced = q ? priceGameMarket(dist, m, q, weights[m]) : null;
    return priced ? [priced] : [];
  });
  const team = (
    t: typeof game.homeTeam,
    id: string,
    days: number | null,
    edge: number,
    missing: MissingPlayer[],
    form: Awaited<ReturnType<typeof teamForm>>
  ): TeamRead => ({
    ...form,
    name: t!.name,
    abbreviation: t!.abbreviation,
    net: ratings.net(id),
    offense: ratings.offense(id),
    defense: ratings.defense(id),
    games: ratings.games(id),
    restDays: days,
    restEdge: edge,
    missing,
  });
  return {
    sport,
    base,
    expected,
    hfa: ratings.hfa,
    home: team(game.homeTeam, h, homeDays, rest.home, homeMissing, homeForm),
    away: team(game.awayTeam, a, awayDays, rest.away, awayMissing, awayForm),
    pHomeWin: pHomeWin(dist),
    fairSpread: fairSpread(dist),
    fairTotal: fairTotal(dist),
    markets,
    marginSd,
    totalSd,
    periodSpecs: fitted?.periods ?? PERIOD_SPECS[sport],
    weights: { ml: weights.ml, spread: weights.spread, total: weights.total },
  };
}
