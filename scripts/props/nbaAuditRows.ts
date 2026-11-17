/**
 * Settled NBA prop picks as the audits read them (audit:performance,
 * audit:plus-money). Each row is a tracked lean (lib/tracking) — frozen
 * BEFORE its game — plus what can be rebuilt from box scores of EARLIER games
 * only (never that night or later): the screener's records, games of history,
 * starter share, recent minutes, the cautious edge. Read-only.
 */
import { prisma } from "@/lib/prisma";
import { etDateOf } from "@/lib/dateEt";
import { NBA_PROP_STATS } from "@/lib/nba/propStats";
import { screenRates, type ScreenWindow } from "@/lib/screener/types";
import { cautiousEdge } from "@/lib/propModel/canonical";
import { decimalOf, impliedOf, type PerfRow } from "@/lib/audit/performance";
import type { GradedLean } from "@/lib/tracking/types";

export type Regime = "pre-correction" | "post-correction";
/** The NBA side correction went live (commit 4241a28, deployed 2026-11-12 22:29 UTC); picks frozen before it were made by the uncorrected model. */
export const CORRECTION_LIVE = Date.parse("2026-11-12T22:29:12Z");
/** The screener sweep (docs/filter-sweep.md, Model lab run #96) chose its sets on games through this ET date; later games are out of its sample. */
export const SWEEP_SAMPLE_END = "2026-11-12";
/** Picks frozen after this carry their screener records and tracked sets (#131 deployed 2026-11-17). */
export const FORWARD_TRACKING_LIVE = Date.parse("2026-11-17T16:51:00Z");

export interface AuditRow extends PerfRow {
  lean: GradedLean;
  regime: Regime;
  /** Frozen after forward tracking began (records and sets frozen with it). */
  forward: boolean;
  alt: boolean;
  side: "over" | "under";
  stat: string;
  date: string;
  book: string;
  projMinutes: number | null;
  /** The projection's distance past the line toward this side ((mean − line) / sd), frozen; null without one. */
  zSide: number | null;
  /** Rebuilt from prior box scores where not frozen. */
  rates: { l5: [number, number]; l10: [number, number]; l15: [number, number]; szn: [number, number] } | null;
  ratesFrozen: boolean;
  /** Every screener window (rebuilt), for running the screener's own filters. */
  allRates: Record<ScreenWindow, [number, number]> | null;
  games: number | null;
  starterShare: number | null;
  /** His average minutes over the last 5 games before this one (rebuilt), and projected minus that. */
  recentMinutes: number | null;
  minutesChange: number | null;
  cautious: number | null;
  /** The Confidence score frozen with the pick (since Nov 12). */
  grade: number | null;
  /** When it was frozen, and whether that was (wrongly) at or after tip. */
  capturedAt: Date | null;
  afterTip: boolean;
  /**
   * The OTHER side of the same line, for a fade: its price, reconstructed from
   * the pick's price and the books' no-vig chance. Every price is DraftKings'
   * and the no-vig chance is DraftKings' own pair de-vigged multiplicatively
   * (lib/odds/devig), so implied(other) = implied(pick) × (1 − nv) / nv exactly,
   * up to the rounding of American odds. Null without a market (alt rungs).
   */
  oppPrice: number | null;
  /** The pair's overround implied by that reconstruction (1.00 = no vig). */
  overround: number | null;
}

/** Implied chance → American odds (rounded as books quote them). */
export function americanOfImplied(q: number): number {
  return q >= 0.5 ? Math.round((-100 * q) / (1 - q)) : Math.round((100 * (1 - q)) / q);
}

/** The other side's price from this side's price and the books' no-vig chance on this side. */
export function oppositePrice(price: number | null, nv: number | null): { price: number; overround: number } | null {
  if (price === null || nv === null || nv <= 0 || nv >= 1) return null;
  const iA = impliedOf(price);
  const iB = (iA * (1 - nv)) / nv;
  if (!(iB > 0 && iB < 1)) return null;
  return { price: americanOfImplied(iB), overround: iA + iB };
}

export async function nbaAuditRows(leans: GradedLean[]): Promise<AuditRow[]> {
  const ids = [...new Set(leans.map((l) => l.features.playerId).filter((x): x is string => Boolean(x)))];
  const logs = ids.length ? await prisma.nbaPlayerGameLog.findMany({ where: { nbaPlayerId: { in: ids }, minutes: { gt: 0 } } }) : [];
  const byPlayer = new Map<string, typeof logs>();
  for (const l of logs) (byPlayer.get(l.nbaPlayerId) ?? byPlayer.set(l.nbaPlayerId, []).get(l.nbaPlayerId)!).push(l);
  for (const list of byPlayer.values()) list.sort((a, b) => b.gameDate.getTime() - a.gameDate.getTime());
  return leans.map((l) => {
    const f = l.features;
    const day = etDateOf(l.startsAt);
    // Games strictly before the pick's game date: nothing from that night or later.
    const prior = (byPlayer.get(f.playerId ?? "") ?? []).filter((g) => etDateOf(g.gameDate) < day);
    const stat = NBA_PROP_STATS.find((s) => s.key === f.stat);
    const season = (byPlayer.get(f.playerId ?? "") ?? []).find((g) => etDateOf(g.gameDate) === day)?.season ?? prior[0]?.season ?? 0;
    const side = f.side === "under" ? "under" : "over";
    const rebuilt = stat && f.point !== null && prior.length ? screenRates(prior.map((g) => ({ season: g.season, value: stat.value(g) })), side, f.point, season) : null;
    const rates = f.rates ?? (rebuilt ? { l5: rebuilt.l5, l10: rebuilt.l10, l15: rebuilt.l15, szn: rebuilt.szn } : null);
    const last10 = prior.slice(0, 10);
    const last5 = prior.slice(0, 5);
    const rate = rates ? (rates.l10[1] >= 5 ? rates.l10 : rates.szn) : null;
    const projMinutes = typeof f.minutes === "number" ? f.minutes : null;
    const recentMinutes = last5.length >= 3 ? last5.reduce((a, g) => a + g.minutes, 0) / last5.length : null;
    // The standout read stores z in over terms; toward the side is its sign flipped for unders.
    const zSide = typeof f.z === "number" && Number.isFinite(f.z) ? (side === "over" ? f.z : -f.z) : null;
    const opp = f.alt ? null : oppositePrice(f.price, f.marketProb);
    const capturedAt = l.capturedAt ?? null;
    return {
      lean: l,
      cluster: l.eventRef ?? day,
      day,
      won: l.result === "hit" ? 1 : 0,
      p: l.prob,
      market: f.marketProb,
      price: f.price,
      close: l.closingProb,
      regime: (capturedAt ?? l.startsAt).getTime() < CORRECTION_LIVE ? "pre-correction" : "post-correction",
      forward: (capturedAt ?? l.startsAt).getTime() >= FORWARD_TRACKING_LIVE,
      alt: Boolean(f.alt),
      side,
      stat: f.stat,
      date: day,
      book: (f.book ?? "unknown").replace(/\s+/g, "").toLowerCase() === "draftkings" ? "DraftKings" : (f.book ?? "unknown"),
      projMinutes,
      zSide,
      rates,
      ratesFrozen: Boolean(f.rates),
      allRates: rebuilt,
      games: stat ? prior.length : null,
      starterShare: last10.length >= 5 ? last10.filter((g) => g.starter).length / last10.length : null,
      recentMinutes,
      minutesChange: projMinutes !== null && recentMinutes !== null ? projMinutes - recentMinutes : null,
      cautious: rate ? cautiousEdge(l.prob, rate, f.price) : null,
      grade: f.confidence?.score ?? null,
      capturedAt,
      afterTip: capturedAt !== null && capturedAt.getTime() >= l.startsAt.getTime(),
      oppPrice: opp?.price ?? null,
      overround: opp?.overround ?? null,
    } satisfies AuditRow;
  });
}

export { decimalOf };
