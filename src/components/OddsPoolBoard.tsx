"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { OddsPool, OddsPlay } from "@/lib/queries/oddsPool";
import type { SlateSport } from "@/lib/queries/slate";
import { CompetitorAvatar } from "./dashboard/CompetitorAvatar";
import { decimalToAmerican, formatAmerican } from "@/lib/odds/americanOdds";
import { formatEv, evColorClass } from "@/lib/odds/format";

const SPORT_META: Record<SlateSport, { label: string; icon: string }> = {
  mlb: { label: "MLB", icon: "⚾" },
  tennis: { label: "Tennis", icon: "🎾" },
  soccer: { label: "Soccer", icon: "⚽" },
  ufc: { label: "UFC", icon: "🥊" },
};

const STEPS = 200; // slider resolution across the decimal domain

function timeLabel(startUtc: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(startUtc);
}

type SortKey = "value" | "price" | "time";

function PlayRow({ play }: { play: OddsPlay }) {
  const backHome = play.side === "home";
  const backAway = play.side === "away";
  return (
    <Link href={play.href} className="flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-accent/50">
      <span aria-hidden className="w-5 shrink-0 text-center text-sm" title={SPORT_META[play.sport].label}>
        {SPORT_META[play.sport].icon}
      </span>
      <span className="w-11 shrink-0 font-mono text-[11px] text-muted-foreground">{timeLabel(play.startUtc)}</span>

      {/* The play: which side you're backing, with both avatars for context. */}
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="flex shrink-0 items-center -space-x-1.5">
          <span className={backAway ? "" : "opacity-40 grayscale"}>
            <CompetitorAvatar sport={play.sport} side={play.away} size={22} />
          </span>
          <span className={backHome ? "" : "opacity-40 grayscale"}>
            <CompetitorAvatar sport={play.sport} side={play.home} size={22} />
          </span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">{play.pickName}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {play.away.name} @ {play.home.name}
          </span>
        </span>
      </span>

      {/* Best price + book */}
      <span className="w-16 shrink-0 text-right">
        <span className="block font-mono text-sm font-semibold tabular-nums text-foreground">
          {formatAmerican(play.bestPrice)}
        </span>
        <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
          {play.bestBookInitials}
        </span>
      </span>

      {/* Value */}
      <span className="w-14 shrink-0 text-right">
        <span
          className={`font-mono text-xs font-semibold tabular-nums ${evColorClass(play.ev)}`}
          title={play.ev === null ? "Three-way market — no fair-price value yet" : "EV of this price vs de-vigged consensus"}
        >
          {play.ev === null ? "—" : formatEv(play.ev)}
        </span>
      </span>
    </Link>
  );
}

export function OddsPoolBoard({ pool }: { pool: OddsPool }) {
  const [sport, setSport] = useState<SlateSport | "all">("all");
  const [sort, setSort] = useState<SortKey>("value");
  const [posOnly, setPosOnly] = useState(false);

  const { minDecimal, maxDecimal } = pool.bounds ?? { minDecimal: 1.5, maxDecimal: 2.5 };
  const span = Math.max(maxDecimal - minDecimal, 0.0001);
  const idxToDecimal = (i: number) => minDecimal + (i / STEPS) * span;

  // Slider handles live in integer step-space over the decimal domain (decimal
  // is the monotonic axis; see americanOdds.ts). Default = full range.
  const [lo, setLo] = useState(0);
  const [hi, setHi] = useState(STEPS);
  const loDecimal = idxToDecimal(lo);
  const hiDecimal = idxToDecimal(hi);
  const fullRange = lo === 0 && hi === STEPS;

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, mlb: 0, tennis: 0, soccer: 0 };
    for (const p of pool.plays) {
      c.all++;
      c[p.sport]++;
    }
    return c;
  }, [pool.plays]);

  const visible = useMemo(() => {
    const filtered = pool.plays.filter((p) => {
      if (sport !== "all" && p.sport !== sport) return false;
      if (p.bestDecimal < loDecimal - 1e-9 || p.bestDecimal > hiDecimal + 1e-9) return false;
      if (posOnly && (p.ev === null || p.ev < 0)) return false;
      return true;
    });
    if (sort === "time") return [...filtered].sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
    if (sort === "price") return [...filtered].sort((a, b) => b.bestDecimal - a.bestDecimal);
    return filtered; // pool is already value-sorted
  }, [pool.plays, sport, sort, loDecimal, hiDecimal, posOnly]);

  const chips: Array<{ key: SlateSport | "all"; label: string; count: number }> = [
    { key: "all", label: "All", count: counts.all },
    ...(["mlb", "tennis", "soccer"] as SlateSport[])
      .map((s) => ({ key: s, label: SPORT_META[s].label, count: counts[s] ?? 0 }))
      .filter((c) => c.count > 0),
  ];

  const pctLo = (lo / STEPS) * 100;
  const pctHi = (hi / STEPS) * 100;

  return (
    <div>
      {/* Odds-range slider — the core control, pinned at the top and always visible. */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Odds range</span>
          <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
            {formatAmerican(decimalToAmerican(loDecimal))} <span className="text-muted-foreground">to</span>{" "}
            {formatAmerican(decimalToAmerican(hiDecimal))}
          </span>
        </div>

        <div className="odds-range relative mt-4 h-5 text-primary">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
          <div
            className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary"
            style={{ left: `${pctLo}%`, right: `${100 - pctHi}%` }}
          />
          <input
            type="range"
            min={0}
            max={STEPS}
            value={lo}
            onChange={(e) => setLo(Math.min(Number(e.target.value), hi))}
            aria-label="Minimum price"
          />
          <input
            type="range"
            min={0}
            max={STEPS}
            value={hi}
            onChange={(e) => setHi(Math.max(Number(e.target.value), lo))}
            aria-label="Maximum price"
          />
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <label className="flex cursor-pointer items-center gap-1.5 select-none">
            <input
              type="checkbox"
              checked={posOnly}
              onChange={(e) => setPosOnly(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            <span className="font-medium">＋Value only</span>
          </label>
          <span className="tabular-nums">
            {visible.length} play{visible.length === 1 ? "" : "s"}
            {(!fullRange || posOnly || sport !== "all") && (
              <button
                type="button"
                onClick={() => {
                  setLo(0);
                  setHi(STEPS);
                  setPosOnly(false);
                  setSport("all");
                }}
                className="ml-2 font-medium text-muted-foreground hover:text-foreground hover:underline"
              >
                Clear
              </button>
            )}
          </span>
        </div>
      </div>

      {/* Sport filter + sort */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
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
          {(["value", "price", "time"] as SortKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setSort(key)}
              aria-pressed={sort === key}
              className={`rounded px-2 py-1 font-medium capitalize transition-colors ${
                sort === key ? "bg-accent text-foreground" : "hover:text-foreground"
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="mt-10 text-center text-sm text-muted-foreground">
          {pool.plays.length === 0 ? "No priced moneylines on the board for this date." : "No plays in this price range."}
        </p>
      ) : (
        <>
          <div className="mt-4 flex items-center gap-3 px-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            <span className="w-5" />
            <span className="w-11">Time</span>
            <span className="flex-1">Play</span>
            <span className="w-16 text-right">Best</span>
            <span className="w-14 text-right">Value</span>
          </div>
          <div className="mt-1 divide-y divide-border/50">
            {visible.map((play) => (
              <PlayRow key={play.key} play={play} />
            ))}
          </div>
        </>
      )}

      <style>{`
        .odds-range input[type="range"] {
          position: absolute; inset: 0; width: 100%; height: 100%; margin: 0;
          -webkit-appearance: none; appearance: none; background: transparent; pointer-events: none;
        }
        .odds-range input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none; pointer-events: auto;
          width: 18px; height: 18px; border-radius: 9999px; background: currentColor;
          border: 2px solid var(--background, #0a0e17); box-shadow: 0 1px 3px rgba(0,0,0,.35); cursor: pointer;
        }
        .odds-range input[type="range"]::-moz-range-thumb {
          pointer-events: auto; width: 18px; height: 18px; border: 2px solid var(--background, #0a0e17);
          border-radius: 9999px; background: currentColor; box-shadow: 0 1px 3px rgba(0,0,0,.35); cursor: pointer;
        }
        .odds-range input[type="range"]::-moz-range-track { background: transparent; }
      `}</style>
    </div>
  );
}
