"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { InfoTip } from "@/components/InfoTip";
import type { PropBoard as PropBoardData, PropBoardRow, PropLineCells } from "@/lib/props/boardTypes";
import type { PropHitRateResult } from "@/lib/props/hitRate";

function cellsForLine(row: PropBoardRow, line: number): PropLineCells | undefined {
  return row.lines.find((l) => l.line === line);
}

function pct(r: PropHitRateResult | null | undefined): number | null {
  return r && r.hitRate !== null ? r.hitRate : null;
}

/** Color by strength — the % itself carries the info, so color is a redundant cue only. */
function rateClass(hitRate: number | null): string {
  if (hitRate === null) return "text-muted-foreground/50";
  if (hitRate >= 0.7) return "text-emerald-600 dark:text-emerald-400 font-semibold";
  if (hitRate >= 0.55) return "text-foreground";
  return "text-muted-foreground";
}

function RateCell({ result }: { result: PropHitRateResult | null | undefined }) {
  const rate = pct(result);
  if (rate === null) {
    return <span className="tabular-nums text-muted-foreground/50">—</span>;
  }
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className={`tabular-nums text-sm ${rateClass(rate)}`}>{Math.round(rate * 100)}%</span>
      <span className="tabular-nums text-[10px] text-muted-foreground/70">
        {result!.hits}/{result!.sampleSize}
      </span>
    </span>
  );
}

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
}: {
  board: PropBoardData;
  date: string;
  basePath?: string;
  extraQuery?: string;
}) {
  const [activeLine, setActiveLine] = useState<number>(
    board.lines[Math.floor(board.lines.length / 2)] ?? board.lines[0] ?? 0.5
  );
  const [sortCol, setSortCol] = useState<string>("l10");

  const rows = useMemo(() => {
    const withCells = board.rows.map((row) => ({ row, cells: cellsForLine(row, activeLine)?.cells }));
    return withCells.sort((a, b) => {
      const av = pct(a.cells?.[sortCol]);
      const bv = pct(b.cells?.[sortCol]);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
  }, [board.rows, activeLine, sortCol]);

  const activeStat = board.stats.find((s) => s.key === board.activeStatKey);

  return (
    <div>
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
        <p className="mt-8 text-center text-sm text-muted-foreground">
          No prop data for this date yet — hit rates need recent game logs for the day&apos;s players.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-right">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pr-2 text-left font-medium">Player</th>
                {board.columns.map((c) => (
                  <th key={c.key} className="px-2 py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => setSortCol(c.key)}
                      className={`hover:text-foreground ${sortCol === c.key ? "text-foreground underline decoration-dotted underline-offset-4" : ""}`}
                    >
                      {c.label}
                    </button>
                  </th>
                ))}
                <th className="px-2 py-2 font-medium" title="Live-odds EV lights up here once paid props coverage is on">
                  EV
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ row, cells }, i) => (
                <tr key={row.id} className="border-b border-border/40 hover:bg-accent/40">
                  <td className="py-2 pr-2 text-left">
                    <div className="flex items-center gap-2.5">
                      <span className="w-4 shrink-0 tabular-nums text-xs text-muted-foreground/60">{i + 1}</span>
                      <Logo
                        sources={row.entityImageUrl ? [row.entityImageUrl] : []}
                        alt={row.entityName}
                        fallbackText={row.entityName.split(" ").map((p) => p[0]).slice(0, 2).join("")}
                        size={30}
                      />
                      <span className="flex flex-col leading-tight">
                        <span className="text-sm font-medium text-foreground">{row.entityName}</span>
                        {row.meta && <span className="text-[11px] text-muted-foreground">{row.meta}</span>}
                      </span>
                    </div>
                  </td>
                  {board.columns.map((c) => (
                    <td key={c.key} className="px-2 py-2">
                      <RateCell result={cells?.[c.key]} />
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    <span className="tabular-nums text-xs text-muted-foreground/40" title="Paid props-odds EV coming">
                      —
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
