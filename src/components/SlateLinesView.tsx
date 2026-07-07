"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { GameLineRow, GameSummary, GameWithLines } from "@/lib/queries/games";
import type { TeamHitRates } from "@/lib/queries/hitRate";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { calculateEv } from "@/lib/odds/devig";
import { computeLineEconomics, historicalProbBySide, lineKey } from "@/lib/odds/lineEconomics";
import { SIDE_LABELS, formatEv, evColorClass, formatPoint } from "@/lib/odds/format";
import type { ExpectedRuns } from "@/lib/archer/expectedRuns";
import { archerProbForRow } from "@/lib/archer/runProbability";
import { PriceRangeSlider } from "./PriceRangeSlider";
import { MarketTabs } from "./MarketTabs";
import { TeamBadge } from "./TeamBadge";
import { BookBadge } from "./BookBadge";
import { PointFilterSelect, MAIN_LINE, ALL_ALT_LINES, type PointFilter } from "./PointFilterSelect";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const SORT_OPTIONS = [
  { key: "marketEv", label: "Best Mkt EV" },
  { key: "historicalEv", label: "Best Hist EV" },
  { key: "archerEv", label: "Best Archer EV" },
  { key: "priceBest", label: "Best price" },
  { key: "priceWorst", label: "Worst price" },
] as const;

type SortKey = (typeof SORT_OPTIONS)[number]["key"];

interface SlateRow {
  game: GameSummary;
  line: GameLineRow;
  marketEv: number | null;
  historicalEv: number | null;
  archerEv: number | null;
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
    if (sortKey === "archerEv") return compareByMetric(a.archerEv, b.archerEv);
    const da = americanToDecimal(a.line.priceAmerican);
    const db = americanToDecimal(b.line.priceAmerican);
    return sortKey === "priceBest" ? db - da : da - db;
  });
  return sorted;
}

interface SlateLinesViewProps {
  gamesWithLines: GameWithLines[];
  hitRatesByTeam: Record<string, TeamHitRates>;
  /** Archer model's home/away win probability per game (see winProbability.ts) — used for the moneyline market. */
  archerProbByGame: Record<string, { home: number | null; away: number | null } | null>;
  /** Archer model's expected runs per game (see expectedRuns.ts) — used for the spreads/totals markets. */
  archerRunsByGame: Record<string, ExpectedRuns | null>;
}

export function SlateLinesView({
  gamesWithLines,
  hitRatesByTeam,
  archerProbByGame,
  archerRunsByGame,
}: SlateLinesViewProps) {
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
          : pointFilter === ALL_ALT_LINES
            ? marketLines.filter((l) => l.isAlternate)
            : marketLines.filter((l) => l.point === pointFilter);

      const archerProb = archerProbByGame[game.id];
      const archerRuns = archerRunsByGame[game.id];

      for (const line of selectedLines) {
        const econ = economics.get(lineKey(line.bookKey, line.side, line.point));
        const archerSideProb = archerProbForRow(market, line.side, line.point, archerProb, archerRuns);

        rows.push({
          game,
          line,
          marketEv: econ?.marketEv ?? null,
          historicalEv: econ?.historicalEv ?? null,
          archerEv: archerSideProb !== null ? calculateEv(archerSideProb, line.priceAmerican) : null,
        });
      }
    }
    return rows;
  }, [gamesWithLines, market, hitRatesByTeam, pointFilter, archerProbByGame, archerRunsByGame]);

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
      <MarketTabs
        market={market}
        onChange={(m) => {
          setMarket(m);
          setRange(null);
          setPointFilter(MAIN_LINE);
        }}
      />

      {!domain || !effectiveRange ? (
        <p className="mt-6 text-sm text-muted-foreground">
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

          <p className="mt-4 text-xs text-muted-foreground">
            Mkt EV = vs. de-vigged market consensus. Hist EV = vs. rolling hit-rate — a noisier,
            directional estimate only (small sample, no opponent/park/pitcher adjustment).
            {market === "h2h"
              ? " Archer EV = vs. the Archer model's pitcher+form win probability."
              : " Archer EV = vs. the Archer model's expected-runs projection (recent runs scored/allowed + starting pitcher ERA)."}
          </p>

          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              {inRange.length} of {allRows.length} lines in range
            </p>
            <div className="flex items-center gap-3">
              {pointOptions.length > 0 && (
                <PointFilterSelect
                  pointOptions={pointOptions}
                  value={pointFilter}
                  market={market}
                  onChange={(v) => {
                    setPointFilter(v);
                    setRange(null);
                  }}
                />
              )}
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                Sort by
                <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
                  <SelectTrigger size="sm" className="text-xs">
                    <SelectValue>
                      {(v: SortKey) => SORT_OPTIONS.find((opt) => opt.key === v)?.label ?? v}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SORT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.key} value={opt.key}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </div>
          </div>

          <ul className="mt-2 divide-y divide-border">
            {inRange.length === 0 && (
              <li className="py-3 text-sm text-muted-foreground">No lines in this range.</li>
            )}
            {inRange.map((row) => (
              <li key={rowKey(row)} className="py-2">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="inline-flex flex-wrap items-center gap-1">
                    <TeamBadge
                      abbreviation={row.game.awayTeam.abbreviation}
                      name={row.game.awayTeam.name}
                      size={16}
                    />
                    <TeamBadge
                      abbreviation={row.game.homeTeam.abbreviation}
                      name={row.game.homeTeam.name}
                      size={16}
                    />
                    <Link
                      href={`/games/${row.game.id}`}
                      className="font-medium text-foreground hover:text-primary hover:underline"
                    >
                      {row.game.awayTeam.abbreviation} @ {row.game.homeTeam.abbreviation}
                    </Link>
                    <span className="ml-1">
                      {SIDE_LABELS[row.line.side]?.(row.game) ?? row.line.side}
                      {formatPoint(row.line.point, market)}
                    </span>
                    <span className="ml-1 inline-flex items-center gap-1 text-muted-foreground">
                      <BookBadge bookKey={row.line.bookKey} bookName={row.line.bookName} size={16} />
                      {row.line.bookName}
                    </span>
                  </span>
                  <span className="font-medium text-foreground">
                    {formatAmerican(row.line.priceAmerican)}
                  </span>
                </div>
                <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs">
                  <span className={evColorClass(row.marketEv)}>
                    Mkt EV: {formatEv(row.marketEv)}
                  </span>
                  <span className={evColorClass(row.historicalEv)}>
                    Hist EV: {formatEv(row.historicalEv)}
                  </span>
                  <span className={evColorClass(row.archerEv)}>
                    Archer EV: {formatEv(row.archerEv)}
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
