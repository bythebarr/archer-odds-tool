/**
 * Graded NFL prop sides for the factor audit: every final NFL game with stored
 * closing quotes, each consensus line's both sides reconstructed from prior
 * games only (the same reconstruction as backtest:props-market) — ARCHR Chance
 * (the blend at the default model weight), the books' no-vig chance, the best
 * closing price, his last-8 record at the line, games of history — and
 * whether the side cashed. Read-only.
 */
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { NFL_PROP_STATS, type NflStatLine } from "@/lib/nfl/propStats";
import { NFL_CALIBRATION_SHRINK, nflRawOver, projectNflProp } from "@/lib/nfl/projection";
import { NFL_LOG_COLUMNS, type NflLogPoint } from "@/lib/nfl/propsMath";
import { propConsensusPoint, twoSidedAt } from "@/lib/nba/propsMath";
import { shrinkLogit } from "@/lib/propModel/distribution";
import { NO_LINES, type GameLines } from "@/lib/propModel/environment";
import { DEFAULT_MODEL_WEIGHT, blendWithMarket, marketRead } from "@/lib/propModel/market";
import type { Rate } from "@/lib/builder/types";
import { closingQuotes } from "./nbaGradedSides";
import type { TeamBaseline } from "./history";
import { screenRates, type ScreenWindow } from "@/lib/screener/types";

export interface NflGradedSide {
  stat: string;
  side: "over" | "under";
  pBlend: number;
  marketChance: number;
  priceAmerican: number | null;
  /** Last 8 games at this line, on this side. */
  rate: Rate;
  /** Every screener window at this line and side, from prior games only (a game the stat isn't on the box score doesn't count). */
  rates: Record<ScreenWindow, Rate>;
  /** The consensus line. */
  point: number;
  sampleGames: number;
  won: 0 | 1;
  date: string;
  /** (projection − line) / its spread, toward this side (as the live sheet computes it). */
  z: number;
}

export async function gradedNflSides(closing: Map<string, GameLines>, baselines: Map<string, { home: TeamBaseline | null; away: TeamBaseline | null }>): Promise<NflGradedSide[]> {
  const games = await prisma.game.findMany({
    where: { sport: "nfl", status: "final", nflPropSnapshots: { some: {} } },
    select: { id: true, scheduledStartUtc: true },
  });
  const out: NflGradedSide[] = [];
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
      const pOver = blendWithMarket(shrinkLogit(nflRawOver(proj, point), NFL_CALIBRATION_SHRINK), market.probOver, DEFAULT_MODEL_WEIGHT);
      const recent = history.filter((l) => !stat.available || stat.available(l)).slice(0, 8).map((l) => stat.value(l));
      const screenLogs = history.map((l) => ({ season: l.season, value: !stat.available || stat.available(l) ? stat.value(l) : null }));
      for (const side of ["over", "under"] as const) {
        const hits = recent.filter((v) => (side === "over" ? v > point : v < point)).length;
        const prices = qs.filter((q) => q.point === point && q.side === side).map((q) => q.priceAmerican);
        out.push({
          stat: statKey,
          side,
          pBlend: side === "over" ? pOver : 1 - pOver,
          marketChance: side === "over" ? market.probOver : 1 - market.probOver,
          priceAmerican: prices.length ? Math.max(...prices) : null,
          rate: [hits, recent.length],
          rates: screenRates(screenLogs, side, point, tonight.season),
          point,
          sampleGames: history.length,
          won: (side === "over" ? actual > point : actual < point) ? 1 : 0,
          date: etDateOf(g.scheduledStartUtc),
          z: ((proj.mean - point) / Math.max(proj.sd, 1e-6)) * (side === "over" ? 1 : -1),
        });
      }
    }
  }
  return out;
}
