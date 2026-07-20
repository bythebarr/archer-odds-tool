"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { OddsPool, OddsPlay, MarketKind } from "@/lib/queries/oddsPool";
import type { SlateSport } from "@/lib/queries/slate";
import { CompetitorAvatar } from "./dashboard/CompetitorAvatar";
import { Logo } from "./Logo";
import { BookBadge } from "./BookBadge";
import { playerLogoSources } from "@/lib/logos";
import { decimalToAmerican, formatAmerican } from "@/lib/odds/americanOdds";
import { formatEv, evColorClass } from "@/lib/odds/format";
import { InfoTip } from "./InfoTip";
import { useSlip, buildSlipPickId, type SlipPick, type SlipSport } from "@/lib/slip/SlipContext";
import type { FeedFreshness } from "@/lib/freshness";
import { EmptyState } from "./EmptyState";
import { FreshnessStamp } from "./FreshnessStamp";
// Sport label/icon comes from the shared client-safe meta list (the ONE source),
// so this board's chips can't drift from nav/the Slate.
import { SPORT_META } from "@/lib/sports";

const KIND_LABEL: Record<MarketKind, string> = { ml: "ML", spread: "Spread", total: "Total", prop: "Prop" };
const KINDS: MarketKind[] = ["ml", "spread", "total", "prop"];

/** Initials for the headshot fallback badge. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}
const STEPS = 200; // slider resolution across the decimal domain

function timeLabel(startUtc: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  }).format(startUtc);
}

type SortKey = "value" | "price" | "time";

/** Maps a pool play to a slip pick — props carry marketType "prop" and drop the point (it's already in the label). */
function toSlipPick(play: OddsPlay): SlipPick {
  const marketType = play.market ?? "prop";
  const sport = play.sport as SlipSport;
  const point = play.kind === "prop" ? null : play.point;
  return {
    id: buildSlipPickId({ sport, matchId: play.matchId, marketType, side: play.side, point, bookKey: play.bestBookKey }),
    sport,
    matchId: play.matchId,
    matchLabel: `${play.away.name} @ ${play.home.name}`,
    selectionLabel: play.selectionLabel,
    marketType,
    point,
    bookKey: play.bestBookKey,
    bookName: play.bestBookName,
    priceAmerican: play.bestPrice,
    ev: play.ev,
    addedAt: 0,
  };
}

/** The +/✓ control that adds or removes a play from the personal slip without navigating. */
function SlipToggle({ play }: { play: OddsPlay }) {
  const { addPick, removePick, isInSlip } = useSlip();
  const pick = toSlipPick(play);
  const inSlip = isInSlip(pick.id);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (inSlip) removePick(pick.id);
        else addPick({ ...pick, addedAt: Date.now() });
      }}
      aria-pressed={inSlip}
      aria-label={inSlip ? `Remove ${play.selectionLabel} from slip` : `Add ${play.selectionLabel} to slip`}
      className={`flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors ${
        inSlip
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border text-muted-foreground hover:border-primary hover:text-foreground"
      }`}
    >
      <svg viewBox="0 0 16 16" fill="none" className="size-3.5">
        {inSlip ? (
          <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        )}
      </svg>
    </button>
  );
}

type Lens = "market" | "model";

const VALUE_TITLE: Record<Lens, string> = {
  market: "EV of this price vs the de-vigged market consensus",
  model: "EV of this price vs the ARCHR Edge model's own probability",
};
const EMPTY_TITLE: Record<Lens, string> = {
  market: "Three-way market — no fair-price value yet",
  model: "No ARCHR Edge model for this play — MLB game lines only",
};

function PlayRow({ play, value, lens }: { play: OddsPlay; value: number | null; lens: Lens }) {
  const matchup =
    play.away.meta && play.home.meta ? `${play.away.meta} @ ${play.home.meta}` : `${play.away.name} @ ${play.home.name}`;
  return (
    <div className="group flex items-center gap-2.5 rounded-md pl-2 pr-1 transition-colors hover:bg-accent/50">
      <Link href={play.href} className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5">
        {play.kind === "prop" ? (
        <span className="shrink-0">
          <Logo
            sources={[play.playerImageUrl ?? "", ...playerLogoSources(play.playerName ?? "")].filter(Boolean)}
            alt={play.playerName ?? play.selectionLabel}
            fallbackText={initials(play.playerName ?? "")}
            size={24}
          />
        </span>
      ) : (
        <span className="flex shrink-0 items-center -space-x-1.5">
          <span className={play.backed === null || play.backed === "away" ? "" : "opacity-40 grayscale"}>
            <CompetitorAvatar sport={play.sport} side={play.away} size={20} />
          </span>
          <span className={play.backed === null || play.backed === "home" ? "" : "opacity-40 grayscale"}>
            <CompetitorAvatar sport={play.sport} side={play.home} size={20} />
          </span>
        </span>
      )}

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{play.selectionLabel}</span>
          <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
            <span className="shrink-0 rounded bg-muted px-1 text-[9px] font-semibold uppercase tracking-wide">
              {KIND_LABEL[play.kind]}
            </span>
            <span className="truncate">
              {matchup} · {timeLabel(play.startUtc)}
            </span>
          </span>
        </span>

        <span className="w-[84px] shrink-0 text-right" title={`Best price — ${play.bestBookName}${play.booksCount > 1 ? ` (best of ${play.booksCount} books)` : ""}`}>
          <span className="flex items-center justify-end gap-1">
            <BookBadge bookKey={play.bestBookKey} bookName={play.bestBookName} size={14} />
            <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
              {formatAmerican(play.bestPrice)}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{play.bestBookName}</span>
        </span>

        <span className="flex w-12 shrink-0 justify-end">
          {value !== null && value > 0 ? (
            <span
              className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-emerald-700 dark:text-emerald-400"
              title={VALUE_TITLE[lens]}
            >
              {formatEv(value)}
            </span>
          ) : (
            <span
              className={`px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums ${evColorClass(value)}`}
              title={value === null ? EMPTY_TITLE[lens] : VALUE_TITLE[lens]}
            >
              {value === null ? "—" : formatEv(value)}
            </span>
          )}
        </span>
      </Link>
      <SlipToggle play={play} />
    </div>
  );
}

export function OddsPoolBoard({ pool, freshness }: { pool: OddsPool; freshness?: FeedFreshness }) {
  const [sport, setSport] = useState<SlateSport | "all">("all");
  const [kind, setKind] = useState<MarketKind | "all">("all");
  const [sort, setSort] = useState<SortKey>("value");
  const [posOnly, setPosOnly] = useState(false);
  const [lens, setLens] = useState<Lens>("market");

  // The active value for a play depends on the lens: market (best price vs
  // de-vigged consensus) or model (best price vs Archer's win probability).
  const valueOf = (p: OddsPlay): number | null => (lens === "market" ? p.ev : p.modelEv);
  const modelCount = useMemo(() => pool.plays.filter((p) => p.modelEv !== null).length, [pool.plays]);

  const { minDecimal, maxDecimal } = pool.bounds ?? { minDecimal: 1.5, maxDecimal: 2.5 };
  const span = Math.max(maxDecimal - minDecimal, 0.0001);
  const idxToDecimal = (i: number) => minDecimal + (i / STEPS) * span;

  const [lo, setLo] = useState(0);
  const [hi, setHi] = useState(STEPS);
  const loDecimal = idxToDecimal(lo);
  const hiDecimal = idxToDecimal(hi);
  const fullRange = lo === 0 && hi === STEPS;

  const sportCounts = useMemo(() => {
    const c: Record<string, number> = { all: pool.plays.length, mlb: 0, tennis: 0, soccer: 0 };
    for (const p of pool.plays) c[p.sport]++;
    return c;
  }, [pool.plays]);

  const kindCounts = useMemo(() => {
    const c: Record<string, number> = { all: pool.plays.length, ml: 0, spread: 0, total: 0, prop: 0 };
    for (const p of pool.plays) c[p.kind]++;
    return c;
  }, [pool.plays]);

  const visible = useMemo(() => {
    const filtered = pool.plays.filter((p) => {
      if (sport !== "all" && p.sport !== sport) return false;
      if (kind !== "all" && p.kind !== kind) return false;
      if (p.bestDecimal < loDecimal - 1e-9 || p.bestDecimal > hiDecimal + 1e-9) return false;
      const v = lens === "market" ? p.ev : p.modelEv;
      if (posOnly && (v === null || v < 0)) return false;
      return true;
    });
    if (sort === "time") return [...filtered].sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
    if (sort === "price") return [...filtered].sort((a, b) => b.bestDecimal - a.bestDecimal);
    // Value sort must be explicit per-lens (the pool arrives pre-sorted by market EV only).
    const val = (p: OddsPlay) => (lens === "market" ? p.ev : p.modelEv) ?? -Infinity;
    return [...filtered].sort((a, b) => val(b) - val(a) || a.startUtc.getTime() - b.startUtc.getTime());
  }, [pool.plays, sport, kind, sort, loDecimal, hiDecimal, posOnly, lens]);

  const sportChips: Array<{ key: SlateSport | "all"; label: string; count: number }> = [
    { key: "all", label: "All", count: sportCounts.all },
    ...(["mlb", "tennis", "soccer"] as SlateSport[])
      .map((s) => ({ key: s, label: SPORT_META[s].label, count: sportCounts[s] ?? 0 }))
      .filter((c) => c.count > 0),
  ];

  const posCount = useMemo(() => {
    return visible.filter((p) => {
      const v = lens === "market" ? p.ev : p.modelEv;
      return v !== null && v > 0;
    }).length;
  }, [visible, lens]);
  const anyFilter = !fullRange || posOnly || sport !== "all" || kind !== "all";
  const pctLo = (lo / STEPS) * 100;
  const pctHi = (hi / STEPS) * 100;

  return (
    <div>
      {freshness && pool.plays.length > 0 ? (
        <div className="mb-3 flex justify-end">
          <FreshnessStamp freshness={freshness} />
        </div>
      ) : null}

      {/* Odds-range slider — the core control, pinned at the top and always visible. */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-baseline justify-between">
          <InfoTip id="odds-range" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Odds range
          </InfoTip>
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
          <input type="range" min={0} max={STEPS} value={lo} onChange={(e) => setLo(Math.min(Number(e.target.value), hi))} aria-label="Minimum price" />
          <input type="range" min={0} max={STEPS} value={hi} onChange={(e) => setHi(Math.max(Number(e.target.value), lo))} aria-label="Maximum price" />
        </div>

        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <label className="flex cursor-pointer select-none items-center gap-1.5">
            <input type="checkbox" checked={posOnly} onChange={(e) => setPosOnly(e.target.checked)} className="size-3.5 accent-primary" />
            <span className="font-medium">＋Value only</span>
          </label>
          <span className="tabular-nums">
            {visible.length} play{visible.length === 1 ? "" : "s"}
            {posCount > 0 && <span className="ml-1 font-semibold text-emerald-600 dark:text-emerald-400">· {posCount} +value</span>}
            {anyFilter && (
              <button
                type="button"
                onClick={() => {
                  setLo(0);
                  setHi(STEPS);
                  setPosOnly(false);
                  setSport("all");
                  setKind("all");
                }}
                className="ml-2 font-medium text-muted-foreground hover:text-foreground hover:underline"
              >
                Clear
              </button>
            )}
          </span>
        </div>
      </div>

      {/* Value-lens toggle — market (line-shopping vs consensus) or model (Archer prob vs price).
          Only offered when the day has at least one modeled play (MLB moneylines). */}
      {modelCount > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <InfoTip id="market-vs-model" className="font-semibold uppercase tracking-wide text-muted-foreground">
            Value vs
          </InfoTip>
          <div className="inline-flex rounded-lg bg-muted p-0.5">
            {(["market", "model"] as Lens[]).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLens(l)}
                aria-pressed={lens === l}
                className={`rounded-md px-3 py-1 font-semibold capitalize transition-colors ${
                  lens === l ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
          <span className="text-muted-foreground">
            {lens === "market" ? (
              <>
                Best price vs the <InfoTip id="de-vig">de-vigged</InfoTip> market
              </>
            ) : (
              "ARCHR Edge vs price · MLB game lines"
            )}
          </span>
        </div>
      )}

      {/* Market kind segmented control — scrolls horizontally if it's tight on a phone. */}
      <div className="mt-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="inline-flex rounded-lg bg-muted p-0.5 text-xs">
          {(["all", ...KINDS] as Array<MarketKind | "all">).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className={`whitespace-nowrap rounded-md px-3 py-1 font-semibold transition-colors ${
                kind === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {k === "all" ? "All" : KIND_LABEL[k]}
              <span className="ml-1 opacity-60">{kindCounts[k]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Sport chips + sort */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {sportChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setSport(chip.key)}
              aria-pressed={sport === chip.key}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                sport === chip.key ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
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
        pool.plays.length === 0 ? (
          <EmptyState
            title="No priced plays on the board yet"
            freshness={freshness}
            arrow="miss"
            supportContext="slate-value-empty"
          >
            Odds for this date haven&apos;t posted, or nothing is scheduled.
          </EmptyState>
        ) : (
          <p className="mt-10 text-center text-sm text-muted-foreground">No plays match these filters.</p>
        )
      ) : (
        <>
          <div className="mt-4 flex items-center gap-2.5 pl-2 pr-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            <span className="w-[34px]" />
            <span className="flex-1">Play</span>
            <span className="w-[84px] text-right">Best price</span>
            <span className="w-12 text-right">Value</span>
            <span className="w-7" />
          </div>
          <div className="mt-1 divide-y divide-border/50">
            {visible.map((play) => (
              <PlayRow key={play.key} play={play} value={valueOf(play)} lens={lens} />
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
