"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { GameLineRow, GameSummary, GameWithLines } from "@/lib/queries/games";
import type { TeamHitRates } from "@/lib/queries/hitRate";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { computeLineEconomics, historicalProbBySide, lineKey } from "@/lib/odds/lineEconomics";
import { SIDE_LABELS, formatEv, evColorClass, formatPoint } from "@/lib/odds/format";
import { BOOK_INITIALS, BOOK_COLORS } from "@/lib/odds/bookAllowlist";
import { bookLogoSources, teamLogoSources } from "@/lib/logos";
import { TEAM_COLORS } from "@/lib/teamColors";
import { PriceRangeSlider } from "./PriceRangeSlider";
import { Logo } from "./Logo";

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

const MAIN_LINE = "main" as const;
type PointFilter = typeof MAIN_LINE | number;

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
  const [pointFilter, setPointFilter] = useState<PointFilter>(MAIN_LINE);

  // Distinct points on offer across the whole slate for the active market —
  // h2h has none (its point is always null), so the dropdown just won't
  // render for that tab. Selecting one of these shops that exact number
  // across every game, whether it's that game's main line or an alt line.
  const pointOptions = useMemo(() => {
    const points = new Set<number>();
    for (const { lines } of gamesWithLines) {
      for (const line of lines) {
        if (line.marketType === market && line.point !== null) points.add(line.point);
      }
    }
    return [...points].sort((a, b) => a - b);
  }, [gamesWithLines, market]);

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

      const selectedLines =
        pointFilter === MAIN_LINE
          ? marketLines.filter((l) => !l.isAlternate)
          : marketLines.filter((l) => l.point === pointFilter);

      for (const line of selectedLines) {
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
  }, [gamesWithLines, market, hitRatesByTeam, pointFilter]);

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
      <div className="sticky top-0 z-10 flex gap-2 border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        {MARKET_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setMarket(tab.key);
              setRange(null);
              setPointFilter(MAIN_LINE);
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

          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-xs text-zinc-400">
              {inRange.length} of {allRows.length} lines in range
            </p>
            <div className="flex items-center gap-3">
              {pointOptions.length > 0 && (
                <label className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  Line
                  <select
                    value={pointFilter === MAIN_LINE ? MAIN_LINE : String(pointFilter)}
                    onChange={(e) => {
                      const value = e.target.value;
                      setPointFilter(value === MAIN_LINE ? MAIN_LINE : Number(value));
                      setRange(null);
                    }}
                    className="rounded border border-zinc-200 bg-transparent px-2 py-1 text-xs text-zinc-900 dark:border-zinc-800 dark:text-zinc-50"
                  >
                    <option value={MAIN_LINE}>Main line</option>
                    {pointOptions.map((p) => (
                      <option key={p} value={p}>
                        {formatPoint(p)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
          </div>

          <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-800">
            {inRange.length === 0 && (
              <li className="py-3 text-sm text-zinc-400">No lines in this range.</li>
            )}
            {inRange.map((row) => (
              <li key={rowKey(row)} className="py-2">
                <div className="flex items-center justify-between text-zinc-600 dark:text-zinc-400">
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <Logo
                      sources={teamLogoSources(row.game.awayTeam.abbreviation)}
                      alt={row.game.awayTeam.name}
                      fallbackText={row.game.awayTeam.abbreviation}
                      color={TEAM_COLORS[row.game.awayTeam.abbreviation]}
                      size={16}
                    />
                    <Logo
                      sources={teamLogoSources(row.game.homeTeam.abbreviation)}
                      alt={row.game.homeTeam.name}
                      fallbackText={row.game.homeTeam.abbreviation}
                      color={TEAM_COLORS[row.game.homeTeam.abbreviation]}
                      size={16}
                    />
                    <Link
                      href={`/games/${row.game.id}`}
                      className="font-medium text-zinc-900 hover:underline dark:text-zinc-50"
                    >
                      {row.game.awayTeam.abbreviation} @ {row.game.homeTeam.abbreviation}
                    </Link>
                    <span className="ml-1">
                      {SIDE_LABELS[row.line.side]?.(row.game) ?? row.line.side}
                      {formatPoint(row.line.point)}
                    </span>
                    <span className="ml-1 inline-flex items-center gap-1 text-zinc-400">
                      <Logo
                        sources={bookLogoSources(row.line.bookKey)}
                        alt={row.line.bookName}
                        fallbackText={BOOK_INITIALS[row.line.bookKey] ?? row.line.bookKey.slice(0, 2).toUpperCase()}
                        color={BOOK_COLORS[row.line.bookKey]}
                        size={16}
                      />
                      {row.line.bookName}
                    </span>
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
