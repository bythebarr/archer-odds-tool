/**
 * Graded NBA prop sides for the props backtests (backtest:cautious-edge,
 * backtest:confidence): every final NBA game with stored closing quotes, each
 * consensus line's both sides reconstructed from prior games only — ARCHR
 * Chance (the blend at DEFAULT_MODEL_WEIGHT), the market's no-vig chance, the
 * best closing price, his L10 record (plain and role-weighted), how many games
 * of history the projection had, and his projected vs recent minutes — with
 * whether the side cashed. Read-only.
 */
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { NBA_PROP_STATS } from "@/lib/nba/propStats";
import { CALIBRATION_SHRINK, projectProp, rawOver } from "@/lib/nba/projection";
import type { GameLogPoint, PropQuote } from "@/lib/nba/propsMath";
import { propConsensusPoint, twoSidedAt } from "@/lib/nba/propsMath";
import { shrinkLogit } from "@/lib/propModel/distribution";
import { NO_LINES, type GameLines } from "@/lib/propModel/environment";
import { DEFAULT_MODEL_WEIGHT, blendWithMarket, marketRead } from "@/lib/propModel/market";
import { roleWeightedRecord, type TonightRole } from "@/lib/propModel/cautiousRead";
import { projectNbaMinutes } from "@/lib/nba/minutes";
import type { Rate } from "@/lib/builder/types";
import type { TeamBaseline } from "./history";

export interface GradedSide {
  stat: string;
  side: "over" | "under";
  /** ARCHR Chance for this side. */
  pBlend: number;
  /** The books' no-vig chance for this side at the close. */
  marketChance: number;
  rate: Rate;
  roleRate: Rate | null;
  /** Best closing price on this side; null when only the other side was posted. */
  priceAmerican: number | null;
  /** Games of history the projection had. */
  sampleGames: number;
  /** Projected minutes that night (prior games only) and his last-10 average. */
  minutes: { projected: number; recent: number | null } | null;
  won: 0 | 1;
  /** ET date of the game. */
  date: string;
}

export function closingQuotes<T extends { playerId: string; stat: string; bookKey: string; side: string; point: number; priceAmerican: number; polledAt: Date }>(
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

export async function gradedNbaSides(closing: Map<string, GameLines>, baselines: Map<string, { home: TeamBaseline | null; away: TeamBaseline | null }>): Promise<GradedSide[]> {
  const games = await prisma.game.findMany({
    where: { sport: "nba", status: "final", nbaPropSnapshots: { some: {} } },
    select: { id: true, scheduledStartUtc: true },
  });
  const out: GradedSide[] = [];
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
      if (!stat || !tonight) continue;
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
      const pModel = shrinkLogit(rawOver(proj, point), CALIBRATION_SHRINK);
      const pOver = blendWithMarket(pModel, market.probOver, DEFAULT_MODEL_WEIGHT);
      // That night's expected role, from prior games only (no lineups stored historically).
      const m = projectNbaMinutes(history, { date: etDateOf(g.scheduledStartUtc) });
      const role: TonightRole | null = m ? { minutes: m.minutes, starter: m.role === null ? null : m.role === "starter" } : null;
      const record = history.map((l) => ({ value: stat.value(l), minutes: l.minutes, starter: l.starter }));
      const recentMinutes = history.slice(0, 10);
      const minutes = m ? { projected: m.minutes, recent: recentMinutes.length ? recentMinutes.reduce((a, l) => a + l.minutes, 0) / recentMinutes.length : null } : null;
      for (const side of ["over", "under"] as const) {
        // The screener's record: the player's last 10 games before tonight, at this line, on this side.
        const rate = roleWeightedRecord(record, side, point, null, 10);
        const roleRate = role ? roleWeightedRecord(record, side, point, role, 10) : null;
        // The best closing price on this side at this line — the price the cautious edge reads against.
        const prices = qs.filter((q) => q.point === point && q.side === side).map((q) => q.priceAmerican);
        const won: 0 | 1 = (side === "over" ? actual > point : actual < point) ? 1 : 0;
        out.push({
          stat: statKey,
          side,
          pBlend: side === "over" ? pOver : 1 - pOver,
          marketChance: side === "over" ? market.probOver : 1 - market.probOver,
          rate,
          roleRate,
          priceAmerican: prices.length ? Math.max(...prices) : null,
          sampleGames: history.length,
          minutes,
          won,
          date: etDateOf(g.scheduledStartUtc),
        });
      }
    }
  }
  return out;
}
