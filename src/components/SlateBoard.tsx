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

function ModelCell({ item }: { item: SlateItem }) {
  const fav = modelFavored(item);
  if (!fav) {
    return <span className="text-xs text-muted-foreground/60">—</span>;
  }
  const name = fav.side === "home" ? item.home.meta ?? item.home.name : item.away.meta ?? item.away.name;
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

  const visible = useMemo(() => {
    const filtered = sport === "all" ? slate.items : slate.items.filter((i) => i.sport === sport);
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
  }, [slate.items, sport, sort]);

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

      {visible.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">Nothing on the board for this date.</p>
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
