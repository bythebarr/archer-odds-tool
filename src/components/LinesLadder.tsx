"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { GameLineRow } from "@/lib/queries/games";
import { americanToDecimal, formatAmerican } from "@/lib/odds/americanOdds";
import { formatEv, evColorClass, formatPoint } from "@/lib/odds/format";
import { lineKey } from "@/lib/odds/lineEconomics";
import { Badge } from "@/components/ui/badge";
import { PriceRangeSlider } from "./PriceRangeSlider";
import { BookBadge } from "./BookBadge";
import { useSlip, buildSlipPickId, type SlipSport } from "@/lib/slip/SlipContext";

export interface LinesLadderEvColumn {
  label: string;
  valueFor: (row: GameLineRow) => number | null;
}

export interface LinesLadderAltGroup {
  point: number | null;
  rows: GameLineRow[];
}

export interface LinesLadderSideHeader {
  badge: ReactNode | null;
  label: string;
  caption?: ReactNode;
}

interface LinesLadderProps {
  rows: GameLineRow[];
  /** Explicit side order (e.g. soccer's away/draw/home); defaults to first-seen order. */
  sideOrder?: string[];
  sideHeader: (side: string) => LinesLadderSideHeader;
  /** [] or undefined = no EV row shown (soccer v1). */
  evColumns?: LinesLadderEvColumn[];
  /** Per-side alt-line groups (MLB-only); undefined = no alt-lines section. */
  altSections?: Map<string, LinesLadderAltGroup[]>;
  disclaimer: ReactNode;
  emptyMessage: ReactNode;
  gridColsClassName?: string;
  /** Enough context to build a slip entry from a row — omitted means no add-to-slip control is rendered. */
  slipContext?: { sport: SlipSport; matchId: string; matchLabel: string };
}

function EvRow({ row, evColumns }: { row: GameLineRow; evColumns: LinesLadderEvColumn[] }) {
  if (evColumns.length === 0) return null;
  return (
    <div className="flex justify-end gap-3 text-xs">
      {evColumns.map((col) => {
        const value = col.valueFor(row);
        return (
          <span key={col.label} className={evColorClass(value)}>
            {col.label}: {formatEv(value)}
          </span>
        );
      })}
    </div>
  );
}

function AddToSlipButton({
  row,
  sideLabel,
  slipContext,
}: {
  row: GameLineRow;
  sideLabel: string;
  slipContext: { sport: SlipSport; matchId: string; matchLabel: string };
}) {
  const { addPick, removePick, isInSlip } = useSlip();
  const id = buildSlipPickId({
    sport: slipContext.sport,
    matchId: slipContext.matchId,
    marketType: row.marketType,
    side: row.side,
    point: row.point,
    bookKey: row.bookKey,
  });
  const inSlip = isInSlip(id);

  return (
    <button
      type="button"
      onClick={() =>
        inSlip
          ? removePick(id)
          : addPick({
              id,
              sport: slipContext.sport,
              matchId: slipContext.matchId,
              matchLabel: slipContext.matchLabel,
              selectionLabel: `${sideLabel}${formatPoint(row.point, row.marketType)}`.trim(),
              marketType: row.marketType,
              point: row.point,
              bookKey: row.bookKey,
              bookName: row.bookName,
              priceAmerican: row.priceAmerican,
              addedAt: Date.now(),
            })
      }
      aria-label={inSlip ? "Remove from slip" : "Add to slip"}
      aria-pressed={inSlip}
      className={`ml-2 flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors ${
        inSlip
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:border-primary hover:text-primary"
      }`}
    >
      {inSlip ? (
        <svg viewBox="0 0 12 12" fill="none" className="size-3">
          <path d="M2.5 6.5l2.2 2.2L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 12 12" fill="none" className="size-3">
          <path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )}
    </button>
  );
}

function LadderRow({
  row,
  isBest,
  evColumns,
  compact,
  sideLabel,
  slipContext,
}: {
  row: GameLineRow;
  isBest: boolean;
  evColumns: LinesLadderEvColumn[];
  compact?: boolean;
  sideLabel: string;
  slipContext?: { sport: SlipSport; matchId: string; matchLabel: string };
}) {
  return (
    <li className={compact ? "py-1.5" : "py-2"}>
      <div
        className={`flex items-center justify-between ${
          isBest ? "font-semibold text-foreground" : "text-muted-foreground"
        }`}
      >
        <span className="inline-flex items-center gap-1.5">
          <BookBadge bookKey={row.bookKey} bookName={row.bookName} size={compact ? 14 : 16} />
          {row.bookName}
          {isBest && (
            <Badge className="ml-2 border-transparent bg-emerald-100 text-emerald-800 hover:bg-emerald-100 dark:bg-emerald-900 dark:text-emerald-200">
              BEST
            </Badge>
          )}
        </span>
        <span className="inline-flex items-center">
          {formatPoint(row.point, row.marketType)} {formatAmerican(row.priceAmerican)}
          {slipContext && <AddToSlipButton row={row} sideLabel={sideLabel} slipContext={slipContext} />}
        </span>
      </div>
      <EvRow row={row} evColumns={evColumns} />
    </li>
  );
}

/**
 * Shared price-ladder grid: side-grouping, price-range slider, BEST-badge
 * ranking, per-row EV columns, and the MLB-only alt-lines section. Devig/
 * Archer-model math and market-specific chrome (tabs, point filter) stay in
 * each sport's own caller — only the genuinely identical grid/slider/row
 * machinery lives here.
 */
export function LinesLadder({
  rows,
  sideOrder,
  sideHeader,
  evColumns = [],
  altSections,
  disclaimer,
  emptyMessage,
  gridColsClassName = "sm:grid-cols-2",
  slipContext,
}: LinesLadderProps) {
  const sides = useMemo(() => {
    const bySide = new Map<string, GameLineRow[]>();
    for (const line of rows) {
      const list = bySide.get(line.side) ?? [];
      list.push(line);
      bySide.set(line.side, list);
    }
    for (const list of bySide.values()) {
      list.sort((a, b) => americanToDecimal(b.priceAmerican) - americanToDecimal(a.priceAmerican));
    }
    return bySide;
  }, [rows]);

  const orderedSides = useMemo(
    () => (sideOrder ?? [...sides.keys()]).filter((side) => sides.has(side)),
    [sideOrder, sides]
  );

  const domain = useMemo(() => {
    if (rows.length === 0) return null;
    const decimals = rows.map((l) => americanToDecimal(l.priceAmerican));
    return { min: Math.min(...decimals), max: Math.max(...decimals) };
  }, [rows]);

  const [range, setRange] = useState<[number, number] | null>(null);
  const effectiveRange: [number, number] | null = range ?? (domain ? [domain.min, domain.max] : null);

  if (!domain || !effectiveRange) {
    return <p className="mt-6 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <>
      <div className="mt-6">
        <PriceRangeSlider min={domain.min} max={domain.max} value={effectiveRange} onChange={setRange} />
      </div>

      <p className="mt-4 text-xs text-muted-foreground">{disclaimer}</p>

      <div className={`mt-4 grid grid-cols-1 gap-6 ${gridColsClassName}`}>
        {orderedSides.map((side) => {
          const rowsForSide = sides.get(side) ?? [];
          const inRange = rowsForSide.filter((r) => {
            const d = americanToDecimal(r.priceAmerican);
            return d >= effectiveRange[0] && d <= effectiveRange[1];
          });
          const bestKey = inRange[0] ? lineKey(inRange[0].bookKey, inRange[0].side, inRange[0].point) : null;
          const header = sideHeader(side);
          const altGroups = altSections?.get(side) ?? [];

          return (
            <div key={side}>
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                {header.badge}
                {header.label}
              </h3>
              {header.caption && <p className="text-xs text-muted-foreground">{header.caption}</p>}
              <p className="mb-2 text-xs text-muted-foreground">
                {inRange.length} of {rowsForSide.length} books in range
              </p>
              <ul className="divide-y divide-border">
                {inRange.length === 0 && (
                  <li className="py-3 text-sm text-muted-foreground">No books in this range.</li>
                )}
                {inRange.map((row) => {
                  const key = lineKey(row.bookKey, row.side, row.point);
                  return (
                    <LadderRow
                      key={row.bookKey}
                      row={row}
                      isBest={key === bestKey}
                      evColumns={evColumns}
                      sideLabel={header.label}
                      slipContext={slipContext}
                    />
                  );
                })}
              </ul>

              {altGroups.length > 0 && (
                <div className="mt-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Alt lines
                  </h4>
                  {altGroups.map(({ point, rows: altRows }) => (
                    <div key={String(point)} className="mt-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        {formatPoint(point, altRows[0]?.marketType ?? "h2h")}
                      </p>
                      <ul className="divide-y divide-border">
                        {altRows.map((row) => (
                          <LadderRow
                            key={row.bookKey}
                            row={row}
                            isBest={false}
                            evColumns={evColumns}
                            compact
                            sideLabel={header.label}
                            slipContext={slipContext}
                          />
                        ))}
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
  );
}
