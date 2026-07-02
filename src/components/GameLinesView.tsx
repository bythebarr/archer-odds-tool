"use client";

import { useMemo, useState } from "react";
import type { GameLineRow, GameSummary } from "@/lib/queries/games";
import type { HitRateResult, TeamHitRates } from "@/lib/queries/hitRate";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { PriceRangeSlider } from "./PriceRangeSlider";

const MARKET_TABS: { key: GameLineRow["marketType"]; label: string }[] = [
  { key: "h2h", label: "Moneyline" },
  { key: "spreads", label: "Spread" },
  { key: "totals", label: "Total" },
];

const SIDE_LABELS: Record<string, (game: GameSummary) => string> = {
  home: (g) => g.homeTeam.name,
  away: (g) => g.awayTeam.name,
  over: () => "Over",
  under: () => "Under",
};

function formatPoint(point: number | null): string {
  if (point === null) return "";
  return point > 0 ? ` +${point}` : ` ${point}`;
}

function formatHitRate(r: HitRateResult): string {
  if (r.gamesFound === 0) return "no graded games yet";
  const pct = r.hitRate !== null ? `${Math.round(r.hitRate * 100)}%` : "—";
  return `${r.record} (${pct}) last ${r.gamesFound}`;
}

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
}

export function GameLinesView({ game, lines, homeHitRates, awayHitRates }: GameLinesViewProps) {
  const [market, setMarket] = useState<GameLineRow["marketType"]>("h2h");
  const marketLines = useMemo(() => lines.filter((l) => l.marketType === market), [lines, market]);

  const domain = useMemo(() => {
    if (marketLines.length === 0) return null;
    const decimals = marketLines.map((l) => americanToDecimal(l.priceAmerican));
    return { min: Math.min(...decimals), max: Math.max(...decimals) };
  }, [marketLines]);

  const [range, setRange] = useState<[number, number] | null>(null);
  const effectiveRange: [number, number] | null =
    range ?? (domain ? [domain.min, domain.max] : null);

  const sides = useMemo(() => {
    const bySide = new Map<string, GameLineRow[]>();
    for (const line of marketLines) {
      const rows = bySide.get(line.side) ?? [];
      rows.push(line);
      bySide.set(line.side, rows);
    }
    for (const rows of bySide.values()) {
      rows.sort((a, b) => americanToDecimal(b.priceAmerican) - americanToDecimal(a.priceAmerican));
    }
    return bySide;
  }, [marketLines]);

  return (
    <div>
      <div className="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
        {MARKET_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setMarket(tab.key);
              setRange(null);
            }}
            className={`px-3 py-2 text-sm font-medium ${
              market === tab.key
                ? "border-b-2 border-zinc-900 text-zinc-900 dark:border-zinc-50 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

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

          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {[...sides.entries()].map(([side, rows]) => {
              const inRange = rows.filter((r) => {
                const d = americanToDecimal(r.priceAmerican);
                return d >= effectiveRange[0] && d <= effectiveRange[1];
              });
              const bestKey = inRange[0]
                ? `${inRange[0].bookKey}-${inRange[0].side}-${inRange[0].point}`
                : null;

              return (
                <div key={side}>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
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
                      const key = `${row.bookKey}-${row.side}-${row.point}`;
                      const isBest = key === bestKey;
                      return (
                        <li
                          key={row.bookKey}
                          className={`flex items-center justify-between py-2 ${
                            isBest ? "font-semibold text-zinc-900 dark:text-zinc-50" : "text-zinc-600 dark:text-zinc-400"
                          }`}
                        >
                          <span>
                            {row.bookName}
                            {isBest && (
                              <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200">
                                BEST
                              </span>
                            )}
                          </span>
                          <span>
                            {formatPoint(row.point)} {formatAmerican(row.priceAmerican)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
