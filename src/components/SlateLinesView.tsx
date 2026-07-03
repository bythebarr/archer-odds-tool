"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { GameLineRow, GameSummary, GameWithLines } from "@/lib/queries/games";
import type { TeamHitRates } from "@/lib/queries/hitRate";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { computeLineEconomics, historicalProbBySide, lineKey } from "@/lib/odds/lineEconomics";
import { SIDE_LABELS, formatEv, evColorClass, formatPoint } from "@/lib/odds/format";
import { PriceRangeSlider } from "./PriceRangeSlider";

const MARKET_TABS: { key: GameLineRow["marketType"]; label: string }[] = [
  { key: "h2h", label: "Moneyline" },
  { key: "spreads", label: "Spread" },
  { key: "totals", label: "Total" },
];

const SORT_OPTIONS = [
  { key: "marketEv", label: "Best Mkt EV" },
  { key: "historicalEv", label: "Best Hist EV" },
  { key: "priceBest", label: "Best price" },
  { key: "priceWorst", label: "Worst price" },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]["key"];

interface SlateRow {
  game: GameSummary;
  line: GameLineRow;
  marketEv: number | null;
  historicalEv: number | null;
}

function rowKey(row: SlateRow): string {
  return `${row.game.id}-${lineKey(row.line.bookKey, row.line.side, row.line.point)}`;
}

/** Sorts by the given metric, descending, with nulls always pushed to the end. */
function compareByMetric(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function sortRows(rows: SlateRow[], sortKey: SortKey): SlateRow[] {
  const sorted = [...rows];
  sorted.sort((a, b) => {
    if (sortKey === "marketEv") return compareByMetric(a.marketEv, b.marketEv);
    if (sortKey === "historicalEv") return compareByMetric(a.historicalEv, b.historicalEv);
    const da = americanToDecimal(a.line.priceAmerican);
    const db = americanToDecimal(b.line.priceAmerican);
    return sortKey === "priceBest" ? db - da : da - db;
  });
  return sorted;
}

interface SlateLinesViewProps {
  gamesWithLines: GameWithLines[];
  hitRatesByTeam: Record<string, TeamHitRates>;
}

export function SlateLinesView({ gamesWithLines, hitRatesByTeam }: SlateLinesViewProps) {
  const [market, setMarket] = useState<GameLineRow["marketType"]>("h2h");
  const [sortKey, setSortKey] = useState<SortKey>("marketEv");

  const allRows = useMemo(() => {
    const rows: SlateRow[] = [];
    for (const { game, lines } of gamesWithLines) {
      const marketLines = lines.filter((l) => l.marketType === market);
      if (marketLines.length === 0) continue;

      const homeHitRates = hitRatesByTeam[game.homeTeam.id];
      const awayHitRates = hitRatesByTeam[game.awayTeam.id];
      if (!homeHitRates || !awayHitRates) continue;

      const economics = computeLineEconomics({
        marketType: market,
        lines: marketLines,
        historicalProbBySide: historicalProbBySide(market, homeHitRates, awayHitRates),
      });

      for (const line of marketLines) {
        const econ = economics.get(lineKey(line.bookKey, line.side, line.point));
        rows.push({
          game,
          line,
          marketEv: econ?.marketEv ?? null,
          historicalEv: econ?.historicalEv ?? null,
        });
      }
    }
    return rows;
  }, [gamesWithLines, market, hitRatesByTeam]);

  const domain = useMemo(() => {
    if (allRows.length === 0) return null;
    const decimals = allRows.map((r) => americanToDecimal(r.line.priceAmerican));
    return { min: Math.min(...decimals), max: Math.max(...decimals) };
  }, [allRows]);

  const [range, setRange] = useState<[number, number] | null>(null);
  const effectiveRange: [number, number] | null = useMemo(
    () => range ?? (domain ? [domain.min, domain.max] : null),
    [range, domain]
  );

  const inRange = useMemo(() => {
    if (!effectiveRange) return [];
    const filtered = allRows.filter((r) => {
      const d = americanToDecimal(r.line.priceAmerican);
      return d >= effectiveRange[0] && d <= effectiveRange[1];
    });
    return sortRows(filtered, sortKey);
  }, [allRows, effectiveRange, sortKey]);

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

          <p className="mt-4 text-xs text-zinc-400">
            Mkt EV = vs. de-vigged market consensus. Hist EV = vs. rolling hit-rate — a noisier,
            directional estimate only (small sample, no opponent/park/pitcher adjustment).
          </p>

          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-zinc-400">
              {inRange.length} of {allRows.length} lines in range
            </p>
            <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              Sort by
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="rounded border border-zinc-200 bg-transparent px-2 py-1 text-xs text-zinc-900 dark:border-zinc-800 dark:text-zinc-50"
              >
                {SORT_OPTIONS.map((opt) => (
                  <option key={opt.key} value={opt.key}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {inRange.length === 0 && (
              <li className="py-3 text-sm text-zinc-400">No lines in this range.</li>
            )}
            {inRange.map((row) => (
              <li key={rowKey(row)} className="py-2">
                <div className="flex items-center justify-between text-zinc-600 dark:text-zinc-400">
                  <span>
                    <Link
                      href={`/games/${row.game.id}`}
                      className="font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                    >
                      {row.game.awayTeam.abbreviation} @ {row.game.homeTeam.abbreviation}
                    </Link>
                    <span className="ml-2">
                      {SIDE_LABELS[row.line.side]?.(row.game) ?? row.line.side}
                      {formatPoint(row.line.point)}
                    </span>
                    <span className="ml-2 text-zinc-400">{row.line.bookName}</span>
                  </span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">
                    {formatAmerican(row.line.priceAmerican)}
                  </span>
                </div>
                <div className="flex justify-end gap-3 text-xs">
                  <span className={evColorClass(row.marketEv)}>
                    Mkt EV: {formatEv(row.marketEv)}
                  </span>
                  <span className={evColorClass(row.historicalEv)}>
                    Hist EV: {formatEv(row.historicalEv)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
