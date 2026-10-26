import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { NBA_PROP_STATS } from "@/lib/nba/propStats";
import { CALIBRATION_SHRINK, projectProp, rawOver } from "@/lib/nba/projection";
import type { GameLogPoint, PropQuote } from "@/lib/nba/propsMath";
import { propConsensusPoint, twoSidedAt } from "@/lib/nba/propsMath";
import { NFL_PROP_STATS, type NflStatLine } from "@/lib/nfl/propStats";
import { NFL_CALIBRATION_SHRINK, nflRawOver, projectNflProp } from "@/lib/nfl/projection";
import { NFL_LOG_COLUMNS, type NflLogPoint } from "@/lib/nfl/propsMath";
import { shrinkLogit } from "@/lib/propModel/distribution";
import { NO_LINES, type GameLines } from "@/lib/propModel/environment";
import { marketRead, MIN_FIT_SAMPLES } from "@/lib/propModel/market";
import { fitModelWeight, type BlendSample } from "@/lib/propModel/fit";
import { scoreCalibration, formatCalibrationReport } from "@/lib/engine/calibration";
import { saveReport } from "@/lib/engine/saveReport";
import { blendWithMarket } from "@/lib/propModel/market";
import { closingGameLines, teamBaselinesByGame, type TeamBaseline } from "./props/history";

/**
 * The model against the market, on real book prices: for every graded game
 * with stored prop snapshots, each book's last price before tip at the
 * consensus number is de-vigged into the market's chance of the Over, the
 * model projects the same prop from the player's earlier games only (with the
 * closing spread and total), and the result settles it. Per stat it reports:
 *
 *   - log loss of the model alone, the market alone, and the best blend
 *   - the model weight that blend uses — saved as `market-blend:<sport>:<stat>`,
 *     which the live slates read once a fit has MIN_FIT_SAMPLES props
 *   - calibration of the blend's favored side
 *
 * A model weight near 0 means the market already knows everything the model
 * does; the weight earned is the honest measure of what the model adds.
 *
 * Run: `SPORT=nba npm run backtest:props-market` (or SPORT=nfl; default both).
 */
type Sport = "nba" | "nfl";

interface GradedProp {
  stat: string;
  pModel: number;
  pMarket: number;
  won: 0 | 1;
  date: string;
}

/** Each book's last quote before tip for every (player, stat, book, side, point), grouped per player-stat. */
function closingQuotes<T extends { playerId: string; stat: string; bookKey: string; side: string; point: number; priceAmerican: number; polledAt: Date }>(
  snaps: T[],
  start: Date
): Map<string, PropQuote[]> {
  const latest = new Map<string, T>();
  for (const s of snaps) {
    if (s.polledAt >= start) continue;
    const k = `${s.playerId}|${s.stat}|${s.bookKey}|${s.side}|${s.point}`;
    const prev = latest.get(k);
    if (!prev || s.polledAt > prev.polledAt) latest.set(k, s);
  }
  const out = new Map<string, PropQuote[]>();
  for (const s of latest.values()) {
    const k = `${s.playerId}|${s.stat}`;
    const list = out.get(k) ?? [];
    list.push({ bookKey: s.bookKey, bookName: s.bookKey, side: s.side === "under" ? "under" : "over", point: s.point, priceAmerican: s.priceAmerican });
    out.set(k, list);
  }
  return out;
}

async function gradedNba(closing: Map<string, GameLines>, baselines: Map<string, { home: TeamBaseline | null; away: TeamBaseline | null }>): Promise<GradedProp[]> {
  const games = await prisma.game.findMany({
    where: { sport: "nba", status: "final", nbaPropSnapshots: { some: {} } },
    select: { id: true, scheduledStartUtc: true },
  });
  const out: GradedProp[] = [];
  for (const g of games) {
    const snaps = await prisma.nbaPropSnapshot.findMany({ where: { gameId: g.id } });
    const quotes = closingQuotes(snaps.map((s) => ({ ...s, playerId: s.nbaPlayerId })), g.scheduledStartUtc);
    const playerIds = [...new Set(snaps.map((s) => s.nbaPlayerId))];
    const logs = await prisma.nbaPlayerGameLog.findMany({
      where: { nbaPlayerId: { in: playerIds }, gameDate: { lte: g.scheduledStartUtc }, minutes: { gt: 0 } },
      orderBy: { gameDate: "desc" },
    });
    for (const [key, qs] of quotes) {
      const [playerId, statKey] = key.split("|");
      const stat = NBA_PROP_STATS.find((s) => s.key === statKey);
      const mine = logs.filter((l) => l.nbaPlayerId === playerId);
      const tonight = mine.find((l) => l.gameId === g.id);
      if (!stat || !tonight) continue; // didn't play: the bet is void
      const point = propConsensusPoint(qs);
      if (point === null) continue;
      const market = marketRead(twoSidedAt(qs, point));
      if (!market) continue;
      const history: GameLogPoint[] = mine
        .filter((l) => l.gameId !== g.id && l.gameDate < g.scheduledStartUtc)
        .map((l) => ({ ...l, date: etDateOf(l.gameDate), opponent: "" }));
      const base = baselines.get(g.id);
      const proj = projectProp(history, stat, {
        defense: { season: 0, fromLastSeason: false, teams: {} },
        opponent: null,
        positionGroup: null,
        lines: closing.get(g.id) ?? NO_LINES,
        isHome: tonight.isHome,
        baselineTotal: (tonight.isHome ? base?.home : base?.away)?.combined ?? null,
        season: tonight.season,
      });
      if (!proj) continue;
      const actual = stat.value(tonight);
      if (actual === point) continue; // push
      out.push({
        stat: statKey,
        pModel: shrinkLogit(rawOver(proj, point), CALIBRATION_SHRINK),
        pMarket: market.probOver,
        won: actual > point ? 1 : 0,
        date: etDateOf(g.scheduledStartUtc),
      });
    }
  }
  return out;
}

async function gradedNfl(closing: Map<string, GameLines>, baselines: Map<string, { home: TeamBaseline | null; away: TeamBaseline | null }>): Promise<GradedProp[]> {
  const games = await prisma.game.findMany({
    where: { sport: "nfl", status: "final", nflPropSnapshots: { some: {} } },
    select: { id: true, scheduledStartUtc: true },
  });
  const out: GradedProp[] = [];
  for (const g of games) {
    const snaps = await prisma.nflPropSnapshot.findMany({ where: { gameId: g.id } });
    const quotes = closingQuotes(snaps.map((s) => ({ ...s, playerId: s.nflPlayerId })), g.scheduledStartUtc);
    const playerIds = [...new Set(snaps.map((s) => s.nflPlayerId))];
    const logs = await prisma.nflPlayerGameLog.findMany({
      where: { nflPlayerId: { in: playerIds }, gameDate: { lte: g.scheduledStartUtc } },
      orderBy: { gameDate: "desc" },
    });
    for (const [key, qs] of quotes) {
      const [playerId, statKey] = key.split("|");
      const stat = NFL_PROP_STATS.find((s) => s.key === statKey);
      const mine = logs.filter((l) => l.nflPlayerId === playerId);
      const tonight = mine.find((l) => l.gameId === g.id);
      if (!stat || !tonight) continue;
      const point = propConsensusPoint(qs);
      if (point === null) continue;
      const market = marketRead(twoSidedAt(qs, point));
      if (!market) continue;
      const history: NflLogPoint[] = mine
        .filter((l) => l.gameId !== g.id && l.gameDate < g.scheduledStartUtc)
        .map((l) => ({
          date: etDateOf(l.gameDate),
          opponent: "",
          isHome: l.isHome,
          season: l.season,
          ...(Object.fromEntries(NFL_LOG_COLUMNS.map((c) => [c, l[c]])) as unknown as NflStatLine),
        }));
      const base = baselines.get(g.id);
      const proj = projectNflProp(history, stat, {
        defense: { season: 0, fromLastSeason: false, teams: {} },
        opponent: null,
        position: null,
        lines: closing.get(g.id) ?? NO_LINES,
        isHome: tonight.isHome,
        baselinePoints: (tonight.isHome ? base?.home : base?.away)?.scored ?? null,
        season: tonight.season,
      });
      if (!proj) continue;
      const actual = stat.value(tonight);
      if (actual === point) continue;
      out.push({
        stat: statKey,
        pModel: shrinkLogit(nflRawOver(proj, point), NFL_CALIBRATION_SHRINK),
        pMarket: market.probOver,
        won: actual > point ? 1 : 0,
        date: etDateOf(g.scheduledStartUtc),
      });
    }
  }
  return out;
}

async function run(sport: Sport) {
  const [closing, baselines] = await Promise.all([closingGameLines(sport), teamBaselinesByGame(sport, sport === "nba" ? 30 : 17)]);
  const graded = sport === "nba" ? await gradedNba(closing, baselines) : await gradedNfl(closing, baselines);
  console.log(`\n${sport.toUpperCase()}: ${graded.length} graded props with a market and a projection.`);
  const stats = [...new Set(graded.map((g) => g.stat))];
  for (const stat of stats) {
    const samples: BlendSample[] = graded.filter((g) => g.stat === stat);
    const fit = fitModelWeight(samples);
    console.log(
      `  ${stat}: n=${fit.n} · log loss model ${fit.modelLogLoss.toFixed(4)}, market ${fit.marketLogLoss.toFixed(4)}, blend ${fit.blendLogLoss.toFixed(4)} at model weight ${fit.modelWeight.toFixed(2)}` +
        (fit.n < MIN_FIT_SAMPLES ? ` (below ${MIN_FIT_SAMPLES}: the app keeps its default)` : "")
    );
    const dated = graded.filter((g) => g.stat === stat);
    const calib = dated
      .map((g) => {
        const p = blendWithMarket(g.pModel, g.pMarket, fit.modelWeight);
        const overFav = p >= 0.5;
        return { pred: overFav ? p : 1 - p, won: ((g.won === 1) === overFav ? 1 : 0) as 0 | 1, date: g.date };
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const report = scoreCalibration(calib);
    console.log(formatCalibrationReport(`${sport.toUpperCase()} ${stat} — model + market`, "prop", report));
    await saveReport(`market-blend:${sport}:${stat}`, `${sport.toUpperCase()} props vs the market — ${stat}`, "prop", report, {
      modelWeight: fit.modelWeight,
      modelLogLoss: fit.modelLogLoss,
      marketLogLoss: fit.marketLogLoss,
      blendLogLoss: fit.blendLogLoss,
    });
  }
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
