"use client";

import { useMemo, useState } from "react";
import type { MatchSummary, PlayerSummary } from "@/lib/queries/tennisMatches";
import type { GameLineRow } from "@/lib/queries/games";
import type { HitRateResult } from "@/lib/queries/hitRate";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { calculateEv } from "@/lib/odds/devig";
import { h2hMarketConsensus, lineKey } from "@/lib/odds/lineEconomics";
import { formatEv, evColorClass, formatHitRate } from "@/lib/odds/format";
import { PriceRangeSlider } from "./PriceRangeSlider";
import { BookBadge } from "./BookBadge";
import { PlayerBadge } from "./PlayerBadge";

const SIDE_PLAYER: Record<string, (m: MatchSummary) => PlayerSummary> = {
  home: (m) => m.homePlayer,
  away: (m) => m.awayPlayer,
};

interface MatchLinesViewProps {
  match: MatchSummary;
  lines: GameLineRow[];
  homeHitRate: HitRateResult;
  awayHitRate: HitRateResult;
}

/**
 * Tennis v1's line-shopping view: moneyline-only, no MarketTabs (nothing to
 * tab between yet), no historical/Archer EV (no data source — see the
 * tennis plan doc's non-goals). Reuses h2hMarketConsensus/calculateEv
 * unchanged from the MLB build since both are fully sport-agnostic.
 */
export function MatchLinesView({ match, lines, homeHitRate, awayHitRate }: MatchLinesViewProps) {
  const consensus = useMemo(() => h2hMarketConsensus(lines), [lines]);

  const sides = useMemo(() => {
    const bySide = new Map<string, GameLineRow[]>();
    for (const line of lines) {
      const rows = bySide.get(line.side) ?? [];
      rows.push(line);
      bySide.set(line.side, rows);
    }
    for (const rows of bySide.values()) {
      rows.sort((a, b) => americanToDecimal(b.priceAmerican) - americanToDecimal(a.priceAmerican));
    }
    return bySide;
  }, [lines]);

  const domain = useMemo(() => {
    if (lines.length === 0) return null;
    const decimals = lines.map((l) => americanToDecimal(l.priceAmerican));
    return { min: Math.min(...decimals), max: Math.max(...decimals) };
  }, [lines]);

  const [range, setRange] = useState<[number, number] | null>(null);
  const effectiveRange: [number, number] | null = range ?? (domain ? [domain.min, domain.max] : null);

  function marketEvFor(side: string, priceAmerican: number): number | null {
    const prob = side === "home" ? consensus.fairProbA : side === "away" ? consensus.fairProbB : null;
    return prob !== null ? calculateEv(prob, priceAmerican) : null;
  }

  if (!domain || !effectiveRange) {
    return <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">No odds polled for this match yet.</p>;
  }

  return (
    <div>
      <div className="mt-2">
        <PriceRangeSlider min={domain.min} max={domain.max} value={effectiveRange} onChange={setRange} />
      </div>

      <p className="mt-4 text-xs text-zinc-400">
        Mkt EV = vs. de-vigged market consensus. Tennis v1 is moneyline-only — no historical
        hit-rate or Archer model yet.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
        {[...sides.entries()].map(([side, rows]) => {
          const inRange = rows.filter((r) => {
            const d = americanToDecimal(r.priceAmerican);
            return d >= effectiveRange[0] && d <= effectiveRange[1];
          });
          const bestKey = inRange[0] ? lineKey(inRange[0].bookKey, inRange[0].side, inRange[0].point) : null;
          const player = SIDE_PLAYER[side]?.(match);
          const hitRate = side === "home" ? homeHitRate : side === "away" ? awayHitRate : null;

          return (
            <div key={side}>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {player && <PlayerBadge name={player.name} />}
                {player?.name ?? side}
              </h3>
              {hitRate && <p className="text-xs text-zinc-400">{formatHitRate(hitRate)}</p>}
              <p className="mb-2 text-xs text-zinc-400">
                {inRange.length} of {rows.length} books in range
              </p>
              <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {inRange.length === 0 && (
                  <li className="py-3 text-sm text-zinc-400">No books in this range.</li>
                )}
                {inRange.map((row) => {
                  const key = lineKey(row.bookKey, row.side, row.point);
                  const isBest = key === bestKey;
                  const ev = marketEvFor(row.side, row.priceAmerican);
                  return (
                    <li key={row.bookKey} className="py-2">
                      <div
                        className={`flex items-center justify-between ${
                          isBest
                            ? "font-semibold text-zinc-900 dark:text-zinc-50"
                            : "text-zinc-600 dark:text-zinc-400"
                        }`}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <BookBadge bookKey={row.bookKey} bookName={row.bookName} size={16} />
                          {row.bookName}
                          {isBest && (
                            <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                              BEST
                            </span>
                          )}
                        </span>
                        <span>{formatAmerican(row.priceAmerican)}</span>
                      </div>
                      <div className="flex justify-end gap-3 text-xs">
                        <span className={evColorClass(ev)}>Mkt EV: {formatEv(ev)}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
