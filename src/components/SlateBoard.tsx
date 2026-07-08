"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Slate, SlateItem, SlateSport } from "@/lib/queries/slate";

const SPORT_META: Record<SlateSport, { label: string; icon: string }> = {
  mlb: { label: "MLB", icon: "⚾" },
  tennis: { label: "Tennis", icon: "🎾" },
  soccer: { label: "Soccer", icon: "⚽" },
  ufc: { label: "UFC", icon: "🥊" },
};

type SortKey = "time" | "lean";

/** Time in ET (the MLB slate's home tz), fixed so server and client render identically. */
function timeLabel(startUtc: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(startUtc);
}

/** ET hour (0–23) of the start, for the day/night window filter. Fixed tz so SSR/CSR agree. */
function etHour(startUtc: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: "America/New_York",
    }).format(startUtc)
  );
}

type TimeWindow = "all" | "day" | "night";

/** Day games start before 5pm ET; night is 5pm ET on — the usual MLB split. */
function inTimeWindow(item: SlateItem, window: TimeWindow): boolean {
  if (window === "all") return true;
  const day = etHour(item.startUtc) < 17;
  return window === "day" ? day : !day;
}

/** Slider ceiling: model moneyline leans rarely clear ~30pp, so cap there for usable resolution. */
const MAX_LEAN = 0.3;

/** How far the model leans from a coin flip, in [0,0.5] — the free proxy for "interesting" until paid EV exists. Null items sort last. */
function leanStrength(item: SlateItem): number | null {
  const p = item.modelProb?.home;
  return p === null || p === undefined ? null : Math.abs(p - 0.5);
}

/** The model's favored side + its probability, for the compact model cell. */
function modelFavored(item: SlateItem): { side: "home" | "away"; prob: number } | null {
  const home = item.modelProb?.home;
  const away = item.modelProb?.away;
  if (home === null || home === undefined || away === null || away === undefined) return null;
  return home >= away ? { side: "home", prob: home } : { side: "away", prob: away };
}

/**
 * A compact label for the model cell. A team abbreviation ("NYY") is the ideal
 * short label, but `meta` is overloaded — for UFC it's a W-L record, which
 * isn't an identifier — so records fall back to the name's last token (the
 * fighter's surname). Sports with no meta (tennis) use the surname too.
 */
function compactLabel(side: SlateItem["home"]): string {
  if (side.meta && !/^\d+-\d+/.test(side.meta)) return side.meta;
  const parts = side.name.trim().split(/\s+/);
  return parts[parts.length - 1];
}

function ModelCell({ item }: { item: SlateItem }) {
  const fav = modelFavored(item);
  if (!fav) {
    return <span className="text-xs text-muted-foreground/60">—</span>;
  }
  const name = compactLabel(fav.side === "home" ? item.home : item.away);
  return (
    <span className="whitespace-nowrap font-mono text-xs text-foreground">
      {name} <span className="text-muted-foreground">{Math.round(fav.prob * 100)}%</span>
    </span>
  );
}

/**
 * PAID-EV SEAM in the UI: a muted placeholder today. When SlateItem.ev is
 * populated (paid odds), this shows the real edge/book instead — no other
 * board change needed.
 */
function EvCell({ item }: { item: SlateItem }) {
  if (!item.ev) {
    return (
      <span
        className="whitespace-nowrap rounded bg-muted/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground/60"
        title="Live-odds EV lights up here once paid odds coverage is on"
      >
        EV —
      </span>
    );
  }
  const positive = item.ev.evPct >= 0;
  return (
    <span
      className={`whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[11px] ${
        positive
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
      }`}
    >
      {positive ? "+" : ""}
      {item.ev.evPct.toFixed(1)}%
    </span>
  );
}

function SlateRow({ item }: { item: SlateItem }) {
  return (
    <Link
      href={item.href}
      className="flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-accent/50"
    >
      <span aria-hidden className="w-5 shrink-0 text-center text-sm" title={SPORT_META[item.sport].label}>
        {SPORT_META[item.sport].icon}
      </span>
      <span className="w-12 shrink-0 font-mono text-[11px] text-muted-foreground">{timeLabel(item.startUtc)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-foreground">
          <span className="font-medium">{item.away.name}</span>
          <span className="text-xs text-muted-foreground">@</span>
          <span className="font-medium">{item.home.name}</span>
        </span>
        {item.title ? <span className="block truncate text-[11px] text-muted-foreground">{item.title}</span> : null}
      </span>
      <span className="w-24 shrink-0 text-right">
        <ModelCell item={item} />
      </span>
      <span className="w-14 shrink-0 text-right">
        <EvCell item={item} />
      </span>
    </Link>
  );
}

export function SlateBoard({ slate }: { slate: Slate }) {
  const [sport, setSport] = useState<SlateSport | "all">("all");
  const [sort, setSort] = useState<SortKey>("time");
  // The "seek your perfect bet" controls: how hard the model must lean, and when it plays.
  const [minLean, setMinLean] = useState(0);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>("all");

  const filtersActive = minLean > 0 || timeWindow !== "all";
  const resetFilters = () => {
    setMinLean(0);
    setTimeWindow("all");
  };

  const visible = useMemo(() => {
    const filtered = slate.items.filter((i) => {
      if (sport !== "all" && i.sport !== sport) return false;
      // A lean floor drops rows below it — and rows with no model at all (their
      // lean is unknown, so they can't clear a positive floor).
      if (minLean > 0 && (leanStrength(i) ?? -1) < minLean) return false;
      if (!inTimeWindow(i, timeWindow)) return false;
      return true;
    });
    if (sort === "time") return filtered; // slate is already time-sorted
    // "lean": strongest model lean first, null-model items after (stable within).
    return [...filtered].sort((a, b) => {
      const la = leanStrength(a);
      const lb = leanStrength(b);
      if (la === null && lb === null) return 0;
      if (la === null) return 1;
      if (lb === null) return -1;
      return lb - la;
    });
  }, [slate.items, sport, sort, minLean, timeWindow]);

  const chips: Array<{ key: SlateSport | "all"; label: string; count: number }> = [
    { key: "all", label: "All", count: slate.items.length },
    ...(Object.keys(SPORT_META) as SlateSport[])
      .map((s) => ({ key: s, label: SPORT_META[s].label, count: slate.counts[s] }))
      .filter((c) => c.count > 0),
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setSport(chip.key)}
              aria-pressed={sport === chip.key}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                sport === chip.key
                  ? "bg-foreground text-background"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              }`}
            >
              {chip.label} <span className="opacity-60">{chip.count}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>Sort</span>
          {(["time", "lean"] as SortKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              aria-pressed={sort === key}
              className={`rounded px-2 py-1 font-medium transition-colors ${
                sort === key ? "bg-accent text-foreground" : "hover:text-foreground"
              }`}
            >
              {key === "time" ? "Time" : "Model lean"}
            </button>
          ))}
        </div>
      </div>

      {/* Filter machinery — seek YOUR perfect bet: model-lean floor + time window */}
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="whitespace-nowrap font-medium">
            Model lean ≥ <span className="tabular-nums text-foreground">{Math.round(minLean * 100)}%</span>
          </span>
          <input
            type="range"
            min={0}
            max={MAX_LEAN}
            step={0.01}
            value={minLean}
            onChange={(e) => setMinLean(Number(e.target.value))}
            aria-label="Minimum model lean"
            className="h-1.5 w-28 cursor-pointer accent-foreground sm:w-36"
          />
        </label>

        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span className="font-medium">When</span>
          {(["all", "day", "night"] as TimeWindow[]).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setTimeWindow(w)}
              aria-pressed={timeWindow === w}
              className={`rounded px-2 py-1 font-medium capitalize transition-colors ${
                timeWindow === w ? "bg-accent text-foreground" : "hover:text-foreground"
              }`}
            >
              {w}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {visible.length} bet{visible.length === 1 ? "" : "s"}
          </span>
          {filtersActive && (
            <button
              type="button"
              onClick={resetFilters}
              className="rounded px-2 py-1 font-medium text-muted-foreground hover:text-foreground hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {minLean > 0 && (
        <p className="mt-2 px-1 text-[11px] text-muted-foreground/70">
          A model-lean floor hides sports without a win-probability model yet (their lean is unknown).
        </p>
      )}

      {visible.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">
          {slate.items.length === 0
            ? "Nothing on the board for this date."
            : filtersActive
              ? "No bets match your filters."
              : "Nothing on the board for this sport."}
        </p>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-3 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            <span className="w-5" />
            <span className="w-12">Time</span>
            <span className="flex-1">Matchup</span>
            <span className="w-24 text-right">Model</span>
            <span className="w-14 text-right">EV</span>
          </div>
          <div className="mt-1 divide-y divide-border/50">
            {visible.map((item) => (
              <SlateRow key={item.key} item={item} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
