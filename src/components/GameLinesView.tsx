"use client";

import { useMemo, useState } from "react";
import type { GameLineRow, GameSummary } from "@/lib/queries/games";
import type { TeamHitRates } from "@/lib/queries/hitRate";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { calculateEv } from "@/lib/odds/devig";
import { computeLineEconomics, historicalProbBySide, lineKey } from "@/lib/odds/lineEconomics";
import { SIDE_LABELS, formatEv, evColorClass, formatPoint, formatHitRate } from "@/lib/odds/format";
import type { ExpectedRuns } from "@/lib/archer/expectedRuns";
import { archerProbForRow } from "@/lib/archer/runProbability";
import { PriceRangeSlider } from "./PriceRangeSlider";
import { MarketTabs } from "./MarketTabs";
import { TeamBadge } from "./TeamBadge";
import { BookBadge } from "./BookBadge";
import { PointFilterSelect, MAIN_LINE, ALL_ALT_LINES, type PointFilter } from "./PointFilterSelect";

const SIDE_TEAM_ABBR: Record<string, (game: GameSummary) => string | null> = {
  home: (g) => g.homeTeam.abbreviation,
  away: (g) => g.awayTeam.abbreviation,
  over: () => null,
  under: () => null,
};

/** Hit-rate caption for a given market tab + side, given both teams' precomputed rates. */
function hitRateCaption(
  market: GameLineRow["marketType"],
  side: string,
  homeHitRates: TeamHitRates,
  awayHitRates: TeamHitRates,
  game: GameSummary
): string {
  if (market === "h2h") {
    return side === "home" ? formatHitRate(homeHitRates.h2h) : formatHitRate(awayHitRates.h2h);
  }
  if (market === "spreads") {
    return side === "home" ? formatHitRate(homeHitRates.spreads) : formatHitRate(awayHitRates.spreads);
  }
  // totals: over/under isn't team-specific, so show both teams' rates for this side.
  const homeRate = side === "over" ? homeHitRates.totalsOver : homeHitRates.totalsUnder;
  const awayRate = side === "over" ? awayHitRates.totalsOver : awayHitRates.totalsUnder;
  return `${game.homeTeam.abbreviation} ${formatHitRate(homeRate)} · ${game.awayTeam.abbreviation} ${formatHitRate(awayRate)}`;
}

interface GameLinesViewProps {
  game: GameSummary;
  lines: GameLineRow[];
  homeHitRates: TeamHitRates;
  awayHitRates: TeamHitRates;
  /** Archer model's home/away win probability (see winProbability.ts) — used for the moneyline market. */
  archerWinProb: { home: number | null; away: number | null } | null;
  /** Archer model's expected runs for each team (see expectedRuns.ts) — used for the spreads/totals markets. */
  archerRuns: ExpectedRuns | null;
}

export function GameLinesView({
  game,
  lines,
  homeHitRates,
  awayHitRates,
  archerWinProb,
  archerRuns,
}: GameLinesViewProps) {
  const [market, setMarket] = useState<GameLineRow["marketType"]>("h2h");
  const [pointFilter, setPointFilter] = useState<PointFilter>(MAIN_LINE);
  const marketLines = useMemo(() => lines.filter((l) => l.marketType === market), [lines, market]);
  const altLines = useMemo(() => marketLines.filter((l) => l.isAlternate), [marketLines]);

  // Every point on offer for this market — lets you jump straight to a
  // specific alt line instead of scrolling the ladder below. h2h has none
  // (its point is always null), so the dropdown just won't render for it.
  const pointOptions = useMemo(() => {
    const points = new Set<number>();
    for (const line of marketLines) {
      if (line.point !== null) points.add(line.point);
    }
    return [...points].sort((a, b) => a - b);
  }, [marketLines]);

  // The slider/BEST-badge/list above the ladder compares prices within
  // whatever's picked from the dropdown: the main line by default, one exact
  // alt point, or every alt point pooled together (a -1.5 price isn't the
  // same bet as a -2.5 price, but each row still shows its own point so nothing's hidden).
  const focusLines = useMemo(
    () =>
      pointFilter === MAIN_LINE
        ? marketLines.filter((l) => !l.isAlternate)
        : pointFilter === ALL_ALT_LINES
          ? marketLines.filter((l) => l.isAlternate)
          : marketLines.filter((l) => l.point === pointFilter),
    [marketLines, pointFilter]
  );

  const domain = useMemo(() => {
    if (focusLines.length === 0) return null;
    const decimals = focusLines.map((l) => americanToDecimal(l.priceAmerican));
    return { min: Math.min(...decimals), max: Math.max(...decimals) };
  }, [focusLines]);

  const [range, setRange] = useState<[number, number] | null>(null);
  const effectiveRange: [number, number] | null =
    range ?? (domain ? [domain.min, domain.max] : null);

  const sides = useMemo(() => {
    const bySide = new Map<string, GameLineRow[]>();
    for (const line of focusLines) {
      const rows = bySide.get(line.side) ?? [];
      rows.push(line);
      bySide.set(line.side, rows);
    }
    for (const rows of bySide.values()) {
      rows.sort((a, b) => americanToDecimal(b.priceAmerican) - americanToDecimal(a.priceAmerican));
    }
    return bySide;
  }, [focusLines]);

  const economics = useMemo(
    () =>
      computeLineEconomics({
        marketType: market,
        lines: marketLines,
        historicalProbBySide: historicalProbBySide(market, homeHitRates, awayHitRates),
      }),
    [market, marketLines, homeHitRates, awayHitRates]
  );

  /** EV of one line against the Archer model's probability for that side — win probability for h2h, expected-runs-derived cover probability for spreads/totals. Null if the model has no input data yet. */
  function archerEvForSide(side: string, point: number | null, priceAmerican: number): number | null {
    const prob = archerProbForRow(market, side, point, archerWinProb, archerRuns);
    return prob !== null ? calculateEv(prob, priceAmerican) : null;
  }

  /** Alt points per side, ordered by proximity to that side's main point; each point's rows sorted by EV. */
  const altSectionsBySide = useMemo(() => {
    const byPointBySide = new Map<string, Map<number | null, GameLineRow[]>>();
    for (const line of altLines) {
      const byPoint = byPointBySide.get(line.side) ?? new Map<number | null, GameLineRow[]>();
      const rows = byPoint.get(line.point) ?? [];
      rows.push(line);
      byPoint.set(line.point, rows);
      byPointBySide.set(line.side, byPoint);
    }

    const result = new Map<string, { point: number | null; rows: GameLineRow[] }[]>();
    for (const [side, byPoint] of byPointBySide) {
      const mainPoint = sides.get(side)?.[0]?.point ?? null;
      const groups = [...byPoint.entries()]
        .sort(([a], [b]) => {
          if (a === null || b === null || mainPoint === null) return (a ?? 0) - (b ?? 0);
          return Math.abs(a - mainPoint) - Math.abs(b - mainPoint);
        })
        .map(([point, rows]) => ({
          point,
          rows: [...rows].sort(
            (a, b) =>
              (economics.get(lineKey(b.bookKey, b.side, b.point))?.marketEv ?? -Infinity) -
              (economics.get(lineKey(a.bookKey, a.side, a.point))?.marketEv ?? -Infinity)
          ),
        }));
      result.set(side, groups);
    }
    return result;
  }, [altLines, sides, economics]);

  return (
    <div>
      <MarketTabs
        market={market}
        onChange={(m) => {
          setMarket(m);
          setRange(null);
          setPointFilter(MAIN_LINE);
        }}
      />

      {pointOptions.length > 0 && (
        <div className="mt-4">
          <PointFilterSelect
            pointOptions={pointOptions}
            value={pointFilter}
            market={market}
            onChange={(v) => {
              setPointFilter(v);
              setRange(null);
            }}
          />
        </div>
      )}

      {!domain || !effectiveRange ? (
        <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
          No odds polled for this market yet.
        </p>
      ) : (
        <>
          <div className="mt-6">
            <PriceRangeSlider
              min={domain.min}
              max={domain.max}
              value={effectiveRange}
              onChange={setRange}
            />
          </div>

          <p className="mt-4 text-xs text-zinc-400">
            Mkt EV = vs. de-vigged market consensus. Hist EV = vs. rolling hit-rate — a noisier,
            directional estimate only (small sample, no opponent/park/pitcher adjustment).
            {market === "h2h"
              ? " Archer EV = vs. the Archer model's pitcher+form win probability (see Matchup panel above)."
              : " Archer EV = vs. the Archer model's expected-runs projection (recent runs scored/allowed + starting pitcher ERA)."}
          </p>

          <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {[...sides.entries()].map(([side, rows]) => {
              const inRange = rows.filter((r) => {
                const d = americanToDecimal(r.priceAmerican);
                return d >= effectiveRange[0] && d <= effectiveRange[1];
              });
              const bestKey = inRange[0] ? lineKey(inRange[0].bookKey, inRange[0].side, inRange[0].point) : null;

              const teamAbbr = SIDE_TEAM_ABBR[side]?.(game) ?? null;

              return (
                <div key={side}>
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {teamAbbr && (
                      <TeamBadge abbreviation={teamAbbr} name={SIDE_LABELS[side]?.(game) ?? side} />
                    )}
                    {SIDE_LABELS[side]?.(game) ?? side}
                  </h3>
                  <p className="text-xs text-zinc-400">
                    {hitRateCaption(market, side, homeHitRates, awayHitRates, game)}
                  </p>
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
                      const econ = economics.get(key);
                      const archerEv = archerEvForSide(row.side, row.point, row.priceAmerican);
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
                            <span>
                              {formatPoint(row.point, market)} {formatAmerican(row.priceAmerican)}
                            </span>
                          </div>
                          <div className="flex justify-end gap-3 text-xs">
                            <span className={evColorClass(econ?.marketEv ?? null)}>
                              Mkt EV: {formatEv(econ?.marketEv ?? null)}
                            </span>
                            <span className={evColorClass(econ?.historicalEv ?? null)}>
                              Hist EV: {formatEv(econ?.historicalEv ?? null)}
                            </span>
                            <span className={evColorClass(archerEv)}>
                              Archer EV: {formatEv(archerEv)}
                            </span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  {pointFilter === MAIN_LINE && (altSectionsBySide.get(side) ?? []).length > 0 && (
                    <div className="mt-4">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                        Alt lines
                      </h4>
                      {altSectionsBySide.get(side)!.map(({ point, rows: altRows }) => (
                        <div key={String(point)} className="mt-2">
                          <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                            {formatPoint(point, market)}
                          </p>
                          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
                            {altRows.map((row) => {
                              const econ = economics.get(lineKey(row.bookKey, row.side, row.point));
                              const archerEv = archerEvForSide(row.side, row.point, row.priceAmerican);
                              return (
                                <li key={row.bookKey} className="py-1.5">
                                  <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
                                    <span className="inline-flex items-center gap-1.5">
                                      <BookBadge bookKey={row.bookKey} bookName={row.bookName} size={14} />
                                      {row.bookName}
                                    </span>
                                    <span>{formatAmerican(row.priceAmerican)}</span>
                                  </div>
                                  <div className="flex justify-end gap-3 text-xs">
                                    <span className={evColorClass(econ?.marketEv ?? null)}>
                                      Mkt EV: {formatEv(econ?.marketEv ?? null)}
                                    </span>
                                    <span className={evColorClass(econ?.historicalEv ?? null)}>
                                      Hist EV: {formatEv(econ?.historicalEv ?? null)}
                                    </span>
                                    <span className={evColorClass(archerEv)}>
                                      Archer EV: {formatEv(archerEv)}
                                    </span>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
