import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { devigPair } from "@/lib/odds/devig";
import { etDateOf } from "@/lib/dateEt";
import {
  GAME_MODEL_BY_SPORT,
  PointsRatings,
  adjustExpected,
  keyWeights,
  nbaPlayerImpact,
  NFL_QB_IMPACT,
  pHomeCover,
  pHomeWin,
  pOver,
  restEdge,
  scoreDist,
  type ExpectedScore,
  type GameModelLeague,
  type MissingPlayer,
  type RatingOpts,
} from "@/lib/gameModel";
import { fitModelWeight, type BlendSample } from "@/lib/propModel/fit";
import { blendWithMarket } from "@/lib/propModel/market";
import { scoreCalibration, formatCalibrationReport, type CalibrationSample } from "@/lib/engine/calibration";
import { saveReport } from "@/lib/engine/saveReport";

/**
 * Backtest for the NBA/NFL game model (src/lib/gameModel). Replays every
 * finished game in date order — each one predicted from earlier games only —
 * and reports:
 *
 *   - the ratings' learning rate k that predicts margins best (grid search)
 *   - margin and total error next to the closing spread's and total's
 *   - the spread of real margins/totals around the model (the fitted marginSd /
 *     totalSd the live model reads back)
 *   - what rest and missing players actually did: the average miss of teams on
 *     a back-to-back (or bye / short week), and per point of estimated injury
 *     impact, before those adjustments — the check on their priors
 *   - calibration of the model's moneyline favorite
 *   - per market (moneyline, spread, total) at the closing number: log loss of
 *     the model, the closing market and the best blend, and the model's
 *     fitted weight (saved as market-blend:<sport>:<market>)
 *
 * Missing players: in the history, a rotation player (NBA 18+ min over the
 * team's last 10; NFL the QB with 60%+ of last game's attempts) who has no log
 * for a game his team played is counted as out — the information an injury
 * report gives before tip.
 *
 * Run: `SPORT=nba npm run backtest:games` (or nfl; default both).
 */
type Sport = "nba" | "nfl";

interface G {
  id: string;
  start: Date;
  season: number;
  home: string;
  away: string;
  hs: number;
  as: number;
}

interface Closing {
  spread?: { point: number; home: number; away: number };
  total?: { point: number; over: number; under: number };
  ml?: { home: number; away: number };
}

async function loadGames(sport: Sport): Promise<G[]> {
  const rows = await prisma.game.findMany({
    where: { sport, status: "final", homeScore: { not: null }, awayScore: { not: null }, homeTeamId: { not: null }, awayTeamId: { not: null } },
    orderBy: { scheduledStartUtc: "asc" },
    select: { id: true, scheduledStartUtc: true, season: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });
  return rows.map((r) => ({ id: r.id, start: r.scheduledStartUtc, season: r.season, home: r.homeTeamId!, away: r.awayTeamId!, hs: r.homeScore!, as: r.awayScore! }));
}

async function loadClosing(sport: Sport): Promise<Map<string, Closing>> {
  const rows = await prisma.gameClosingLine.findMany({ where: { game: { sport } } });
  const out = new Map<string, Closing>();
  const tmp = new Map<string, Record<string, { point: number | null; price: number }>>();
  for (const r of rows) {
    const m = tmp.get(r.gameId) ?? {};
    m[`${r.marketType}:${r.side}`] = { point: r.point, price: r.priceAmerican };
    tmp.set(r.gameId, m);
  }
  for (const [id, m] of tmp) {
    const c: Closing = {};
    const sh = m["spreads:home"];
    const sa = m["spreads:away"];
    if (sh?.point != null && sa) c.spread = { point: sh.point, home: sh.price, away: sa.price };
    const to = m["totals:over"];
    const tu = m["totals:under"];
    if (to?.point != null && tu) c.total = { point: to.point, over: to.price, under: tu.price };
    const mh = m["h2h:home"];
    const ma = m["h2h:away"];
    if (mh && ma) c.ml = { home: mh.price, away: ma.price };
    out.set(id, c);
  }
  return out;
}

/** Per game id and team id: who was missing, as described above. */
async function loadMissing(sport: Sport, games: G[]): Promise<Map<string, MissingPlayer[]>> {
  const out = new Map<string, MissingPlayer[]>();
  const key = (gameId: string, teamId: string) => `${gameId}|${teamId}`;
  if (sport === "nba") {
    const logs = await prisma.nbaPlayerGameLog.findMany({
      select: { gameId: true, teamId: true, nbaPlayerId: true, minutes: true, points: true, rebounds: true, assists: true, steals: true, blocks: true, turnovers: true },
    });
    const byGameTeam = new Map<string, typeof logs>();
    for (const l of logs) byGameTeam.set(key(l.gameId, l.teamId), [...(byGameTeam.get(key(l.gameId, l.teamId)) ?? []), l]);
    const teamHistory = new Map<string, (typeof logs)[]>(); // team → its last games' logs
    const playerHistory = new Map<string, typeof logs>(); // player → his logs, most recent first
    for (const g of games) {
      for (const team of [g.home, g.away]) {
        const tonight = byGameTeam.get(key(g.id, team));
        const past = teamHistory.get(team) ?? [];
        if (tonight && past.length >= 5) {
          const present = new Set(tonight.map((l) => l.nbaPlayerId));
          const minutes = new Map<string, number>();
          for (const game of past.slice(0, 10)) for (const l of game) minutes.set(l.nbaPlayerId, (minutes.get(l.nbaPlayerId) ?? 0) + l.minutes);
          const missing: MissingPlayer[] = [];
          for (const [pid, total] of minutes) {
            if (present.has(pid) || total / Math.min(past.length, 10) < 18) continue;
            const impact = nbaPlayerImpact(playerHistory.get(pid) ?? []);
            if (impact >= 0.3) missing.push({ name: pid, status: "Out", impact });
          }
          out.set(key(g.id, team), missing);
        }
        if (tonight) {
          teamHistory.set(team, [tonight, ...past].slice(0, 10));
          for (const l of tonight) playerHistory.set(l.nbaPlayerId, [l, ...(playerHistory.get(l.nbaPlayerId) ?? [])].slice(0, 15));
        }
      }
    }
  } else {
    const logs = await prisma.nflPlayerGameLog.findMany({ select: { gameId: true, teamId: true, nflPlayerId: true, passAttempts: true } });
    const byGameTeam = new Map<string, typeof logs>();
    for (const l of logs) byGameTeam.set(key(l.gameId, l.teamId), [...(byGameTeam.get(key(l.gameId, l.teamId)) ?? []), l]);
    const lastQb = new Map<string, string>();
    for (const g of games) {
      for (const team of [g.home, g.away]) {
        const tonight = byGameTeam.get(key(g.id, team));
        if (!tonight) continue;
        const qb = lastQb.get(team);
        if (qb && !tonight.some((l) => l.nflPlayerId === qb)) out.set(key(g.id, team), [{ name: qb, status: "Out", impact: NFL_QB_IMPACT }]);
        const att = tonight.reduce((a, l) => a + l.passAttempts, 0);
        const lead = [...tonight].sort((a, b) => b.passAttempts - a.passAttempts)[0];
        if (lead && att > 0 && lead.passAttempts / att >= 0.6) lastQb.set(team, lead.nflPlayerId);
      }
    }
  }
  return out;
}

interface Pred {
  g: G;
  base: ExpectedScore;
  adjusted: ExpectedScore;
  restHome: number;
  restAway: number;
  missHome: number;
  missAway: number;
}

/** One chronological pass: each game predicted before its result updates the ratings. */
function replay(games: G[], league: GameModelLeague, opts: RatingOpts, missing: Map<string, MissingPlayer[]>): Pred[] {
  const r = new PointsRatings(opts);
  const last = new Map<string, Date>();
  const preds: Pred[] = [];
  for (const g of games) {
    r.touch(g.home, g.season);
    r.touch(g.away, g.season);
    if (r.games(g.home) >= league.minGames && r.games(g.away) >= league.minGames) {
      const days = (t: string) => {
        const d = last.get(t);
        if (!d) return null;
        const n = Math.round((g.start.getTime() - d.getTime()) / 86_400_000);
        return n > 30 ? null : n;
      };
      const rest = restEdge(league.sport, { homeDays: days(g.home), awayDays: days(g.away) });
      const mh = missing.get(`${g.id}|${g.home}`) ?? [];
      const ma = missing.get(`${g.id}|${g.away}`) ?? [];
      const base = r.expected(g.home, g.away);
      preds.push({
        g,
        base,
        adjusted: adjustExpected(base, rest, { home: mh, away: ma }),
        restHome: rest.home,
        restAway: rest.away,
        missHome: mh.reduce((a, p) => a + p.impact, 0),
        missAway: ma.reduce((a, p) => a + p.impact, 0),
      });
    }
    r.update(g.home, g.away, g.hs, g.as);
    last.set(g.home, g.start);
    last.set(g.away, g.start);
  }
  return preds;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(xs.length - 1, 1));
};

async function run(sport: Sport) {
  const league = GAME_MODEL_BY_SPORT[sport];
  const [games, closing] = await Promise.all([loadGames(sport), loadClosing(sport)]);
  const missing = await loadMissing(sport, games);
  console.log(`\n=== ${sport.toUpperCase()} game model — ${games.length} finished games, ${closing.size} with closing lines ===`);
  if (games.length < 50) {
    console.log("Too few games to backtest.");
    return;
  }

  // 1. The ratings' learning rate.
  const grid = sport === "nba" ? [0.03, 0.04, 0.05, 0.06, 0.08, 0.1] : [0.05, 0.075, 0.1, 0.125, 0.15, 0.2];
  let bestK = league.ratings.k;
  let bestMae = Infinity;
  for (const k of grid) {
    const preds = replay(games, league, { ...league.ratings, k }, missing);
    const mae = mean(preds.map((p) => Math.abs(p.g.hs - p.g.as - (p.adjusted.home - p.adjusted.away))));
    console.log(`  k=${k}: margin MAE ${mae.toFixed(3)} over ${preds.length}`);
    if (mae < bestMae) [bestMae, bestK] = [mae, k];
  }
  console.log(`  best k = ${bestK}${bestK !== league.ratings.k ? ` (baked ${league.ratings.k} — update leagues.ts)` : " (matches the baked value)"}`);

  const preds = replay(games, league, { ...league.ratings, k: bestK }, missing);
  const marginMiss = preds.map((p) => p.g.hs - p.g.as - (p.adjusted.home - p.adjusted.away));
  const totalMiss = preds.map((p) => p.g.hs + p.g.as - (p.adjusted.home + p.adjusted.away));
  const marginSd = sd(marginMiss);
  const totalSd = sd(totalMiss);
  console.log(`  margin: MAE ${mean(marginMiss.map(Math.abs)).toFixed(2)}, sd ${marginSd.toFixed(2)} (baked ${league.marginSd}); total: MAE ${mean(totalMiss.map(Math.abs)).toFixed(2)}, sd ${totalSd.toFixed(2)} (baked ${league.totalSd})`);

  // 2. Against the closing numbers, on the games that have them.
  const withSpread = preds.filter((p) => closing.get(p.g.id)?.spread);
  const withTotal = preds.filter((p) => closing.get(p.g.id)?.total);
  if (withSpread.length) {
    const model = mean(withSpread.map((p) => Math.abs(p.g.hs - p.g.as - (p.adjusted.home - p.adjusted.away))));
    const market = mean(withSpread.map((p) => Math.abs(p.g.hs - p.g.as + closing.get(p.g.id)!.spread!.point)));
    console.log(`  vs closing spread (${withSpread.length} games): model margin MAE ${model.toFixed(2)}, closing spread MAE ${market.toFixed(2)}`);
  }
  if (withTotal.length) {
    const model = mean(withTotal.map((p) => Math.abs(p.g.hs + p.g.as - (p.adjusted.home + p.adjusted.away))));
    const market = mean(withTotal.map((p) => Math.abs(p.g.hs + p.g.as - closing.get(p.g.id)!.total!.point)));
    console.log(`  vs closing total (${withTotal.length} games): model total MAE ${model.toFixed(2)}, closing total MAE ${market.toFixed(2)}`);
  }

  // 3. What rest and absences really did (misses BEFORE those adjustments).
  const baseMiss = (p: Pred, side: "home" | "away") => {
    const margin = p.g.hs - p.g.as - (p.base.home - p.base.away);
    return side === "home" ? margin : -margin;
  };
  const tired = preds.flatMap((p) => [
    ...(p.restHome < 0 ? [baseMiss(p, "home")] : []),
    ...(p.restAway < 0 ? [baseMiss(p, "away")] : []),
  ]);
  const rested = preds.flatMap((p) => [
    ...(p.restHome > 0 ? [baseMiss(p, "home")] : []),
    ...(p.restAway > 0 ? [baseMiss(p, "away")] : []),
  ]);
  if (tired.length) console.log(`  ${sport === "nba" ? "back-to-back" : "short week"}: ${tired.length} team-games, average margin vs ratings ${mean(tired).toFixed(2)} (prior ${sport === "nba" ? "−1.25" : "−0.5"})`);
  if (rested.length) console.log(`  off a bye: ${rested.length} team-games, average margin vs ratings ${mean(rested).toFixed(2)} (prior +0.75)`);
  const inj = preds.flatMap((p) => [
    ...(p.missHome > 0 ? [{ impact: p.missHome, miss: baseMiss(p, "home") }] : []),
    ...(p.missAway > 0 ? [{ impact: p.missAway, miss: baseMiss(p, "away") }] : []),
  ]);
  let slope = NaN;
  if (inj.length >= 20) {
    // Margin lost per point of estimated impact (least squares through the origin).
    slope = -inj.reduce((a, x) => a + x.impact * x.miss, 0) / inj.reduce((a, x) => a + x.impact * x.impact, 0);
    console.log(`  missing players: ${inj.length} team-games, ${slope.toFixed(2)} points lost per point of estimated impact (1.00 = the scale is right)`);
  }

  // 4. Calibration of the moneyline favorite (model alone).
  const weights = league.keyNumbers ? keyWeights(league.keyNumbers, marginSd) : undefined;
  const dists = new Map(preds.map((p) => [p.g.id, scoreDist(p.adjusted, marginSd, totalSd, weights, league.ties)]));
  const mlSamples: (CalibrationSample & { date: string })[] = preds
    .filter((p) => p.g.hs !== p.g.as)
    .map((p) => {
      const ph = pHomeWin(dists.get(p.g.id)!);
      const favHome = ph >= 0.5;
      return { pred: favHome ? ph : 1 - ph, won: ((p.g.hs > p.g.as) === favHome ? 1 : 0) as 0 | 1, date: etDateOf(p.g.start) };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const mlReport = scoreCalibration(mlSamples);
  console.log(formatCalibrationReport(`${sport.toUpperCase()} game model — moneyline favorite`, "game", mlReport));
  await saveReport(`${sport}-games:ml`, `${sport.toUpperCase()} games — moneyline`, "game", mlReport, { k: bestK });

  // 5. Model vs the closing market, per market.
  const blendSets: Record<"ml" | "spread" | "total", (BlendSample & { date: string })[]> = { ml: [], spread: [], total: [] };
  for (const p of preds) {
    const c = closing.get(p.g.id);
    const d = dists.get(p.g.id)!;
    const margin = p.g.hs - p.g.as;
    const total = p.g.hs + p.g.as;
    const date = etDateOf(p.g.start);
    if (c?.ml && margin !== 0) blendSets.ml.push({ pModel: pHomeWin(d), pMarket: devigPair(c.ml.home, c.ml.away).fairA, won: margin > 0 ? 1 : 0, date });
    if (c?.spread && margin + c.spread.point !== 0)
      blendSets.spread.push({ pModel: pHomeCover(d, c.spread.point), pMarket: devigPair(c.spread.home, c.spread.away).fairA, won: margin + c.spread.point > 0 ? 1 : 0, date });
    if (c?.total && total !== c.total.point)
      blendSets.total.push({ pModel: pOver(d, c.total.point), pMarket: devigPair(c.total.over, c.total.under).fairA, won: total > c.total.point ? 1 : 0, date });
  }
  for (const market of ["ml", "spread", "total"] as const) {
    const set = blendSets[market];
    if (set.length === 0) continue;
    const fit = fitModelWeight(set);
    console.log(
      `  ${market}: ${fit.n} games at the close · log loss model ${fit.modelLogLoss.toFixed(4)}, market ${fit.marketLogLoss.toFixed(4)}, blend ${fit.blendLogLoss.toFixed(4)} at model weight ${fit.modelWeight.toFixed(2)}`
    );
    const calib = set
      .map((s) => {
        const p = blendWithMarket(s.pModel, s.pMarket, fit.modelWeight);
        const favA = p >= 0.5;
        return { pred: favA ? p : 1 - p, won: ((s.won === 1) === favA ? 1 : 0) as 0 | 1, date: s.date };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const report = scoreCalibration(calib);
    await saveReport(`market-blend:${sport}:${market}`, `${sport.toUpperCase()} ${market === "ml" ? "moneyline" : market} vs the market`, "game", report, {
      modelWeight: fit.modelWeight,
      modelLogLoss: fit.modelLogLoss,
      marketLogLoss: fit.marketLogLoss,
      blendLogLoss: fit.blendLogLoss,
    });
  }

  // 6. The spread card: ATS calibration of the model alone at the closing number, with the fitted constants.
  const ats = blendSets.spread
    .map((s) => {
      const favA = s.pModel >= 0.5;
      return { pred: favA ? s.pModel : 1 - s.pModel, won: ((s.won === 1) === favA ? 1 : 0) as 0 | 1, date: s.date };
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const atsReport = scoreCalibration(ats.length ? ats : mlSamples);
  await saveReport(`${sport}-games:spread`, `${sport.toUpperCase()} games — spread`, "game", atsReport, {
    marginSd,
    totalSd,
    k: bestK,
    injurySlope: Number.isFinite(slope) ? slope : null,
    // Both errors on the same games: those with a closing spread.
    projectionMae: withSpread.length ? mean(withSpread.map((p) => Math.abs(p.g.hs - p.g.as - (p.adjusted.home - p.adjusted.away)))) : null,
    baselineMae: withSpread.length ? mean(withSpread.map((p) => Math.abs(p.g.hs - p.g.as + closing.get(p.g.id)!.spread!.point))) : null,
    baseline: "closing spread",
  });
}

async function main() {
  const sports: Sport[] = process.env.SPORT === "nba" ? ["nba"] : process.env.SPORT === "nfl" ? ["nfl"] : ["nba", "nfl"];
  for (const s of sports) await run(s);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
