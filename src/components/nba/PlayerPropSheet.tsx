"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { NBA_PROP_STATS, NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { booksAtPoint, propConsensusPoint, summarizeProp, type GameLogPoint, type SlateProp } from "@/lib/nba/propsMath";
import type { SlatePlayer } from "@/lib/queries/nbaProps";
import type { PropDirection, PropHitRateResult } from "@/lib/props/tally";
import type { NbaPropStat } from "@/generated/prisma/client";
import { Logo } from "@/components/Logo";
import { BookBadge } from "@/components/BookBadge";
import { GameLogChart } from "./GameLogChart";
import { formatRate, rateTone } from "./HitMeter";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);
}

function RateTile({ label, rate }: { label: string; rate: PropHitRateResult }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-2 text-center">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`font-mono text-base font-semibold ${rateTone(rate)}`}>{formatRate(rate)}</p>
      <p className="text-[10px] text-muted-foreground">{rate.sampleSize ? `${rate.hits}/${rate.sampleSize}` : "—"}</p>
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
            o.key === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Everything about one player's props in one panel: switch stat, pick any line
 * the books hang, see the hit rates and the last 20 games against it, and every
 * book's price at that line. A bottom sheet on phones, a centered dialog wider up.
 */
export function PlayerPropSheet({
  player,
  props,
  logs,
  season,
  initialStat,
  side: initialSide,
  startLabel,
  onClose,
}: {
  player: SlatePlayer;
  /** All of this player's props tonight, one per stat. */
  props: SlateProp[];
  logs: GameLogPoint[];
  season: number;
  initialStat: NbaPropStat;
  side: PropDirection;
  startLabel: string;
  onClose: () => void;
}) {
  const [stat, setStat] = useState<NbaPropStat>(initialStat);
  const [side, setSide] = useState<PropDirection>(initialSide);
  const prop = props.find((p) => p.stat === stat) ?? props[0];
  const statDef = NBA_PROP_STAT_BY_KEY.get(prop.stat)!;
  const consensus = propConsensusPoint(prop.quotes);
  const [pointByStat, setPointByStat] = useState<Partial<Record<NbaPropStat, number>>>({});
  const point = pointByStat[prop.stat] ?? consensus ?? prop.quotes[0]?.point ?? 0;

  const summary = useMemo(
    () => summarizeProp(prop, logs, statDef, side, { season, venue: player.venue }, point),
    [prop, logs, statDef, side, season, player.venue, point]
  );
  const books = useMemo(() => booksAtPoint(prop.quotes, point, side), [prop.quotes, point, side]);
  const bestBook = side === "over" ? summary?.over?.bookKey : summary?.under?.bookKey;

  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const statsOffered = NBA_PROP_STATS.filter((s) => props.some((p) => p.stat === s.key));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`${player.name} props`}>
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-in fade-in-0"
        onClick={onClose}
      />
      <div className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-background shadow-2xl animate-in slide-in-from-bottom-8 duration-200 sm:max-w-lg sm:rounded-2xl sm:slide-in-from-bottom-0 sm:zoom-in-95">
        <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 pb-3 pt-2 backdrop-blur">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30 sm:hidden" aria-hidden />
          <div className="flex items-center gap-3">
            <div className="relative">
              <Logo sources={[player.headshotUrl]} alt={player.name} fallbackText={initials(player.name)} size={56} fit="cover" />
              {player.team && (
                <span className="absolute -bottom-1 -right-1">
                  <Logo sources={[player.team.logoUrl]} alt={player.team.name} fallbackText={player.team.abbreviation} size={22} />
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-foreground">{player.name}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                {player.opponent && (
                  <>
                    {player.venue === "home" ? "vs" : "@"}
                    <Logo sources={[player.opponent.logoUrl]} alt={player.opponent.name} fallbackText={player.opponent.abbreviation} size={14} />
                    {player.opponent.abbreviation} ·{" "}
                  </>
                )}
                {startLabel}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {statsOffered.length > 1 && (
            <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
              {statsOffered.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStat(s.key)}
                  className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    s.key === prop.stat ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {s.shortLabel}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5 px-4 pb-8 pt-4">
          <section>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">{statDef.label}</p>
                <p className="font-mono text-3xl font-semibold tracking-tight text-foreground">{point}</p>
              </div>
              <Segmented
                options={[
                  { key: "over", label: "Over" },
                  { key: "under", label: "Under" },
                ]}
                value={side}
                onChange={setSide}
              />
            </div>
            {summary && summary.points.length > 1 && (
              <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]" aria-label="Lines">
                {summary.points.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPointByStat((m) => ({ ...m, [prop.stat]: p }))}
                    className={`shrink-0 rounded-md border px-2.5 py-1 font-mono text-xs font-semibold transition-colors ${
                      p === point
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p}
                    {p === consensus && <span className="ml-1 font-sans text-[9px] font-medium text-muted-foreground">MAIN</span>}
                  </button>
                ))}
              </div>
            )}
          </section>

          {summary && (
            <section className="grid grid-cols-5 gap-1.5">
              <RateTile label="L5" rate={summary.hitRates.l5} />
              <RateTile label="L10" rate={summary.hitRates.l10} />
              <RateTile label="L20" rate={summary.hitRates.l20} />
              <RateTile label="Season" rate={summary.hitRates.season} />
              <RateTile
                label={player.venue === "home" ? "Home" : player.venue === "away" ? "Away" : "Venue"}
                rate={summary.hitRates.venue}
              />
            </section>
          )}

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last 20 games</h3>
            <GameLogChart logs={logs} stat={statDef} point={point} side={side} />
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Every book at {point}
            </h3>
            {books.length === 0 ? (
              <p className="text-sm text-muted-foreground">No book prices this number.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                <li className="grid grid-cols-[1fr_4.5rem_4.5rem] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Book</span>
                  <span className="text-right">Over</span>
                  <span className="text-right">Under</span>
                </li>
                {books.map((b) => {
                  const best = b.bookKey === bestBook;
                  return (
                    <li
                      key={b.bookKey}
                      className={`grid grid-cols-[1fr_4.5rem_4.5rem] items-center px-3 py-2 ${best ? "bg-emerald-500/10" : ""} ${b.bettable ? "" : "opacity-60"}`}
                    >
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        <BookBadge bookKey={b.bookKey} bookName={b.bookName} size={20} />
                        <span className="truncate">{b.bookName}</span>
                        {best && (
                          <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white dark:bg-emerald-500">
                            Best
                          </span>
                        )}
                        {!b.bettable && <span className="text-[10px] text-muted-foreground">sharp ref</span>}
                      </span>
                      {(["over", "under"] as const).map((s) => (
                        <span
                          key={s}
                          className={`text-right font-mono text-sm ${s === side ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                        >
                          {b[s] === null ? "—" : formatAmerican(b[s]!)}
                        </span>
                      ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Game log</h3>
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No games logged yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-1 text-left font-medium">Date</th>
                    <th className="pb-1 text-left font-medium">Opp</th>
                    <th className="pb-1 text-right font-medium">Min</th>
                    <th className="pb-1 text-right font-medium">{statDef.shortLabel}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {logs.slice(0, 10).map((g, i) => {
                    const value = statDef.value(g);
                    const cashed = side === "over" ? value > point : value < point;
                    return (
                      <tr key={`${g.date}-${i}`}>
                        <td className="py-1.5 text-muted-foreground">{g.date.slice(5).replace("-", "/")}</td>
                        <td className="py-1.5">
                          {g.isHome ? "vs" : "@"} {g.opponent}
                        </td>
                        <td className="py-1.5 text-right font-mono text-muted-foreground">{g.minutes}</td>
                        <td className="py-1.5 text-right font-mono font-semibold">
                          <span className={cashed ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}>{value}</span>
                          <span className="ml-1 text-[10px] text-muted-foreground">{cashed ? "✓" : "✕"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Hit rates are history, not a projection. Best price is among books you can bet; sharp reference books are shown
            for comparison only.
          </p>
        </div>
      </div>
    </div>
  );
}
