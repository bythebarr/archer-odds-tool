"use client";

import { useMemo, useState } from "react";
import type { PropDirection } from "@/lib/props/tally";

/** Any league's game log, as the chart reads it. */
export interface PropChartLog {
  date: string;
  opponent: string;
  isHome: boolean;
  season: number;
  /** NBA minutes / NFL snaps or touches, when the league logs them. */
  volume?: number;
}

export type ChartFilter = "l5" | "l10" | "l15" | "l20" | "season" | "lastSeason" | "h2h" | "venue";

const WIDTH = 360;
const HEIGHT = 190;
const PAD_TOP = 22;
const PAD_BOTTOM = 30;
const GUTTER = 40;
const PLOT_W = WIDTH - GUTTER;

const tone = (rate: number | null) =>
  rate === null ? "text-muted-foreground" : rate >= 0.7 ? "text-emerald-600 dark:text-brand" : rate >= 0.5 ? "text-foreground" : "text-red-500 dark:text-red-400";

function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/**
 * The prop's history against its line, sportsbook style but deeper: any window
 * (last 5 to last season, tonight's opponent, home or away), every game a bar
 * colored by whether the side cashed, the value on each bar, and three
 * reference lines — the book's line, ARCHR's projection and the window's
 * average. Tap a bar for that game.
 */
export function PropGameChart<L extends PropChartLog>({
  logs,
  value,
  statShort,
  point,
  side,
  season,
  projection,
  opponent,
  venue,
  volumeLabel,
  lineLabel = "Line",
}: {
  /** Most recent first. */
  logs: L[];
  value: (log: L) => number;
  statShort: string;
  point: number;
  side: PropDirection;
  season: number;
  /** ARCHR's projected mean tonight, drawn as its own line. */
  projection: number | null;
  opponent: string | null | undefined;
  venue: "home" | "away" | null;
  /** "min", "snaps" — shown in the readout when logs carry volume. */
  volumeLabel?: string;
  /** "Line" for a book's number, "ARCHR line" before the books post. */
  lineLabel?: string;
}) {
  const filters = useMemo(() => {
    const list: { key: ChartFilter; label: string; games: L[] }[] = [
      { key: "l5", label: "L5", games: logs.slice(0, 5) },
      { key: "l10", label: "L10", games: logs.slice(0, 10) },
      { key: "l15", label: "L15", games: logs.slice(0, 15) },
      { key: "l20", label: "L20", games: logs.slice(0, 20) },
      { key: "season", label: "This szn", games: logs.filter((l) => l.season === season) },
      { key: "lastSeason", label: "Last szn", games: logs.filter((l) => l.season === season - 1) },
    ];
    if (opponent) list.push({ key: "h2h", label: `vs ${opponent}`, games: logs.filter((l) => l.opponent === opponent) });
    if (venue) list.push({ key: "venue", label: venue === "home" ? "Home" : "Away", games: logs.filter((l) => l.isHome === (venue === "home")).slice(0, 20) });
    return list.filter((f) => f.games.length > 0 || f.key === "l10");
  }, [logs, season, opponent, venue]);
  const [filter, setFilter] = useState<ChartFilter>("l10");
  const [active, setActive] = useState<number | null>(null);
  const current = filters.find((f) => f.key === filter) ?? filters[0]!;
  const games = [...current.games].reverse(); // oldest → newest, left to right

  const values = games.map(value);
  const hits = values.filter((v) => (side === "over" ? v > point : v < point)).length;
  const rate = values.length ? hits / values.length : null;
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

  const max = Math.max(point, projection ?? 0, ...values, 1) * 1.15;
  const plotH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const y = (v: number) => PAD_TOP + plotH - (Math.max(v, 0) / max) * plotH;
  const slots = Math.max(games.length, 8);
  const gap = games.length > 30 ? 1.5 : 4;
  const barW = (PLOT_W - gap * (slots - 1)) / slots;
  const labelBars = games.length <= 20;
  const labelOpp = games.length <= 12;
  const shown = active !== null && active < games.length ? active : games.length - 1;
  const g = games[shown];

  // Reference lines, nudged apart so their labels never collide.
  const refs = [
    { key: "line", v: point, label: `${point}`, cls: "stroke-foreground", text: "fill-foreground", dash: "5 3", width: 1.6 },
    ...(projection !== null ? [{ key: "proj", v: projection, label: projection.toFixed(1), cls: "stroke-brand", text: "fill-brand", dash: "2 3", width: 1.6 }] : []),
    ...(avg !== null ? [{ key: "avg", v: avg, label: avg.toFixed(1), cls: "stroke-muted-foreground/70", text: "fill-muted-foreground", dash: "1 3", width: 1.2 }] : []),
  ];
  const placed = new Map<string, number>();
  let lastLabel = -Infinity;
  for (const r of [...refs].sort((a, b) => y(a.v) - y(b.v))) {
    lastLabel = Math.max(y(r.v) + 3.5, lastLabel + 11);
    placed.set(r.key, lastLabel);
  }

  return (
    <div>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist" aria-label="Games">
        {filters.map((f) => (
          <button
            key={f.key}
            type="button"
            role="tab"
            aria-selected={f.key === current.key}
            onClick={() => {
              setFilter(f.key);
              setActive(null);
            }}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
              f.key === current.key ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-lg bg-muted/60 px-2 py-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{side === "over" ? "Over" : "Under"} hit</p>
          <p className={`font-mono text-sm font-bold ${tone(rate)}`}>
            {values.length ? `${hits}/${values.length}` : "—"}
            {rate !== null && <span className="ml-1 text-[11px] font-semibold">{Math.round(rate * 100)}%</span>}
          </p>
        </div>
        <div className="rounded-lg bg-muted/60 px-2 py-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Average</p>
          <p className="font-mono text-sm font-bold text-foreground">
            {avg === null ? "—" : avg.toFixed(1)}
            {avg !== null && (
              <span className={`ml-1 text-[11px] ${avg - point >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"}`}>
                {avg - point >= 0 ? "+" : "−"}
                {Math.abs(avg - point).toFixed(1)}
              </span>
            )}
          </p>
        </div>
        <div className="rounded-lg bg-brand/10 px-2 py-1.5 ring-1 ring-brand/30">
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">ARCHR proj</p>
          <p className="font-mono text-sm font-bold text-foreground">{projection === null ? "—" : projection.toFixed(1)}</p>
        </div>
      </div>

      {games.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">No games in this window.</p>
      ) : (
        <>
          <p className="mt-3 flex items-baseline justify-between text-xs text-muted-foreground">
            <span>
              {shortDate(g.date)} {g.isHome ? "vs" : "@"} {g.opponent}
              {g.volume !== undefined && volumeLabel ? ` · ${g.volume} ${volumeLabel}` : ""}
            </span>
            <span className="font-mono text-sm font-semibold text-foreground">
              {values[shown]} {statShort}
            </span>
          </p>
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="mt-1 w-full touch-none select-none"
            role="img"
            aria-label={`${statShort} in ${current.label}: ${hits} of ${values.length} ${side}s at ${point}`}
            onMouseLeave={() => setActive(null)}
          >
            {games.map((game, i) => {
              const v = values[i]!;
              const cashed = side === "over" ? v > point : v < point;
              const pushed = v === point;
              const top = y(v);
              const x = i * (barW + gap);
              const h = Math.max(PAD_TOP + plotH - top, 2);
              const fill = pushed ? "fill-muted-foreground/60" : cashed ? "fill-emerald-500 dark:fill-brand" : "fill-red-500/80 dark:fill-red-500/70";
              return (
                <g key={`${game.date}-${i}`} onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} className="cursor-pointer">
                  <rect x={x} y={PAD_TOP} width={barW} height={plotH} fill="transparent" />
                  <rect x={x} y={PAD_TOP + plotH - h} width={barW} height={h} rx={barW >= 8 ? 3 : 0} className={`${fill} ${i === shown ? "opacity-100" : "opacity-75"}`} />
                  {labelBars && (
                    <text x={x + barW / 2} y={PAD_TOP + plotH - h - 4} textAnchor="middle" stroke="var(--background)" strokeWidth={3} paintOrder="stroke" className={`text-[10px] font-bold ${i === shown ? "fill-foreground" : "fill-muted-foreground"}`}>
                      {v}
                    </text>
                  )}
                  {labelOpp && (
                    <>
                      <text x={x + barW / 2} y={HEIGHT - 16} textAnchor="middle" className="fill-muted-foreground text-[8.5px] font-semibold">
                        {game.opponent.slice(0, 4)}
                      </text>
                      <text x={x + barW / 2} y={HEIGHT - 5} textAnchor="middle" className="fill-muted-foreground/70 text-[8px]">
                        {shortDate(game.date)}
                      </text>
                    </>
                  )}
                </g>
              );
            })}
            {refs.map((r) => (
              <g key={r.key}>
                <line x1={0} x2={PLOT_W} y1={y(r.v)} y2={y(r.v)} strokeDasharray={r.dash} strokeWidth={r.width} className={r.cls} />
                <text x={WIDTH} y={placed.get(r.key)} textAnchor="end" className={`${r.text} text-[10px] font-bold`}>
                  {r.label}
                </text>
              </g>
            ))}
            {!labelOpp && (
              <>
                <text x={0} y={HEIGHT - 5} className="fill-muted-foreground text-[9px]">
                  {shortDate(games[0]!.date)}
                </text>
                <text x={PLOT_W} y={HEIGHT - 5} textAnchor="end" className="fill-muted-foreground text-[9px]">
                  Last game
                </text>
              </>
            )}
          </svg>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-0 w-4 border-t-[1.6px] border-dashed border-foreground" /> {lineLabel} {point}
            </span>
            {projection !== null && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-0 w-4 border-t-[1.6px] border-dotted border-brand" /> ARCHR {projection.toFixed(1)}
              </span>
            )}
            {avg !== null && (
              <span className="inline-flex items-center gap-1">
                <span className="inline-block h-0 w-4 border-t border-dotted border-muted-foreground" /> Avg {avg.toFixed(1)}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
