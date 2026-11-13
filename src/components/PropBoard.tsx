"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { InfoTip } from "@/components/InfoTip";
import type { PropBoard as PropBoardData, PropBoardRow, PropLineCells } from "@/lib/props/boardTypes";
import type { PropHitRateResult } from "@/lib/props/hitRate";
import type { FeedFreshness } from "@/lib/freshness";
import { CANONICAL_NUMBERS } from "@/lib/propModel/canonical";
import { EmptyState } from "@/components/EmptyState";
import { FreshnessStamp } from "@/components/FreshnessStamp";
import { EdgeLineList, EdgeLineRow } from "@/components/book/EdgeLineRow";

function cellsForLine(row: PropBoardRow, line: number): PropLineCells | undefined {
  return row.lines.find((l) => l.line === line);
}

function pct(r: PropHitRateResult | null | undefined): number | null {
  return r && r.hitRate !== null ? r.hitRate : null;
}





const PROJ_SORT_KEY = "__proj";

/**
 * `basePath`/`extraQuery` let the same board render under different routes: it
 * lives standalone at `/props` (the defaults) and embedded as the Slate's
 * Props tab at `/slate` (basePath="/slate", extraQuery="&tab=props"), so its
 * server-driven view/stat links stay on whichever surface hosts it instead of
 * jumping back to /props.
 */
export function PropBoard({
  board,
  date,
  basePath = "/props",
  extraQuery = "",
  freshness,
}: {
  board: PropBoardData;
  date: string;
  basePath?: string;
  extraQuery?: string;
  freshness?: FeedFreshness;
}) {
  const [activeLine, setActiveLine] = useState<number>(
    board.lines[Math.floor(board.lines.length / 2)] ?? board.lines[0] ?? 0.5
  );
  // Default sort: the hit-rate projection, not raw L10 — the whole point of
  // the projection is that trailing hit-rate overstates hot players.
  const [sortCol, setSortCol] = useState<string>(PROJ_SORT_KEY);

  const rows = useMemo(() => {
    const withCells = board.rows.map((row) => {
      const line = cellsForLine(row, activeLine);
      return { row, cells: line?.cells, projection: line?.projection ?? null };
    });
    return withCells.sort((a, b) => {
      const av = sortCol === PROJ_SORT_KEY ? a.projection?.probability ?? null : pct(a.cells?.[sortCol]);
      const bv = sortCol === PROJ_SORT_KEY ? b.projection?.probability ?? null : pct(b.cells?.[sortCol]);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
  }, [board.rows, activeLine, sortCol]);

  const activeStat = board.stats.find((s) => s.key === board.activeStatKey);

  return (
    <div>
      {freshness && rows.length > 0 ? (
        <div className="mb-3 flex justify-end">
          <FreshnessStamp freshness={freshness} />
        </div>
      ) : null}

      {/* View tabs (Batters / Pitchers) — navigate, resets to the view's first stat */}
      {board.views.length > 1 && (
        <div className="mb-4 inline-flex rounded-lg bg-muted p-0.5">
          {board.views.map((v) => {
            const active = v.key === board.activeView;
            return (
              <Link
                key={v.key}
                href={`${basePath}?date=${date}&view=${v.key}${extraQuery}`}
                scroll={false}
                className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {v.label}
              </Link>
            );
          })}
        </div>
      )}

      {/* Stat chips — navigate (server re-query) */}
      <div className="flex flex-wrap gap-1.5">
        {board.stats.map((s) => {
          const active = s.key === board.activeStatKey;
          return (
            <Link
              key={s.key}
              href={`${basePath}?date=${date}&view=${board.activeView}&stat=${s.key}${extraQuery}`}
              scroll={false}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {s.label}
            </Link>
          );
        })}
      </div>

      {/* Increment (alt-line) selector — the "seek across increments" tool */}
      <div className="mt-4 flex items-center gap-2">
        <InfoTip id="alt-line" className="text-xs font-medium text-muted-foreground">
          Line
        </InfoTip>
        <div className="flex gap-1">
          {board.lines.map((line) => {
            const active = line === activeLine;
            return (
              <button
                key={line}
                type="button"
                onClick={() => setActiveLine(line)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold tabular-nums transition-colors ${
                  active
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {line}+
              </button>
            );
          })}
        </div>
        <span className="ml-auto text-xs text-muted-foreground">
          Over {activeLine} {activeStat?.label}
        </span>
      </div>

      {/* Board */}
      {rows.length === 0 ? (
        <EmptyState
          title="No prop data for this date yet"
          freshness={freshness}
          arrow="miss"
          supportContext="props-empty"
        >
          Hit rates are built from the day&apos;s player game logs.
        </EmptyState>
      ) : (
        <>
          <nav aria-label="Sort" className="mt-4 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="font-semibold uppercase tracking-wide text-muted-foreground">Sort</span>
            {[{ key: PROJ_SORT_KEY, label: CANONICAL_NUMBERS.hitRateProjection.shortLabel }, ...board.columns].map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setSortCol(c.key)}
                aria-pressed={sortCol === c.key}
                className={`rounded-full px-2.5 py-1 font-semibold transition-colors ${sortCol === c.key ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
              >
                {c.label}
              </button>
            ))}
          </nav>
          <EdgeLineList className="mt-2">
            {rows.map(({ row, projection }) => (
              <EdgeLineRow
                key={row.id}
                leading={
                  <Logo
                    sources={row.entityImageUrl ? [row.entityImageUrl] : []}
                    alt={row.entityName}
                    fallbackText={row.entityName.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                    size={28}
                  />
                }
                label={`${row.entityName} Over ${activeLine} ${activeStat?.label ?? ""}`.trim()}
                edge={null}
                chance={{ label: CANONICAL_NUMBERS.hitRateProjection.shortLabel, value: projection?.probability ?? null }}
                whisper={[row.meta, "no book price yet, so no edge"].filter(Boolean).join(" · ")}
                href={row.sport === "mlb" ? `/props/${row.entityId}` : undefined}
              />
            ))}
          </EdgeLineList>
        </>
      )}
    </div>
  );
}
