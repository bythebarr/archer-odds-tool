"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { NBA_PROP_STATS, NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { booksAtPoint, propConsensusPoint, summarizeProp, twoSidedAt, type GameLogPoint, type PropModel, type SlateProp } from "@/lib/nba/propsMath";
import { fairPrice, valueOf } from "@/lib/odds/marketValue";
import { decimalToAmerican } from "@/lib/odds/americanOdds";
import { EvTag } from "@/components/EvTag";
import { InjuryBadge } from "@/components/InjuryBadge";
import type { ProjectionContext } from "@/lib/nba/projection";
import type { SlatePlayer } from "@/lib/queries/nbaProps";
import type { PropDirection } from "@/lib/props/tally";
import type { NbaPropStat } from "@/generated/prisma/client";
import { Logo } from "@/components/Logo";
import { BlendLine, EnvLine, SeasonMixLine, signed } from "@/components/props/ModelPieces";
import { BookBadge } from "@/components/BookBadge";
import { GameLogChart } from "./GameLogChart";
import { MatchupPanel, SplitGrid } from "./Matchup";
import type { DefenseTable } from "@/lib/nba/matchup";

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);
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
          className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
            o.key === value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Factor({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/60 px-2 py-1.5 text-center">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-semibold text-foreground">{value}</p>
    </div>
  );
}

/** ARCHR's projection for this prop: the number, each side's chance at this line, model EV, and what built it. */
function ProjectionPanel({ model, point, side, statShort }: { model: PropModel; point: number; side: PropDirection; statShort: string }) {
  const p = model.projection;
  const ev = side === "over" ? model.evOver : model.evUnder;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const mult = (x: number) => `×${x.toFixed(2)}`;
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-extrabold uppercase italic tracking-wide text-foreground">
        <span className="brand-slash" aria-hidden />
        ARCHR projection
      </h3>
      <div className="rounded-xl border border-border bg-card p-3.5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="font-mono text-3xl font-semibold leading-none tracking-tight text-foreground">
              {p.mean.toFixed(1)}
              <span className="ml-1 font-sans text-xs font-semibold text-muted-foreground">{statShort}</span>
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">± {p.sd.toFixed(1)} typical swing</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">
              at {point}: <span className="font-mono font-semibold text-foreground">O {pct(model.probOver)}</span> ·{" "}
              <span className="font-mono font-semibold text-foreground">U {pct(model.probUnder)}</span>
            </p>
            {ev !== null && (
              <p className={`mt-1 font-mono text-sm font-bold ${ev >= 0.03 ? "text-emerald-600 dark:text-brand" : ev < 0 ? "text-muted-foreground" : "text-foreground"}`}>
                {ev >= 0 ? "+" : ""}
                {(ev * 100).toFixed(1)}% model EV
              </p>
            )}
          </div>
        </div>
        <BlendLine model={model} side={side} />
        <SeasonMixLine seasons={p.seasons} />
        <EnvLine
          parts={[
            ...(p.env.total !== null ? [`total ${p.env.total}`] : []),
            ...(p.env.spread !== null ? [`spread ${signed(p.env.spread)}`] : []),
          ]}
          effects={[
            { label: "production", factor: p.env.totalFactor },
            { label: "minutes", factor: p.env.minutesFactor },
          ]}
        />
        {p.absence && (
          <p className="mt-3 rounded-lg bg-muted/60 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
            <span className="font-semibold text-foreground">Without {p.absence.names.join(" & ")}</span> (out tonight): {p.absence.games}{" "}
            games, {p.absence.minutes.toFixed(1)} min, {p.absence.perMinute.toFixed(2)} {statShort}/min — blended into the numbers below.
          </p>
        )}
        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <Factor label="Minutes" value={p.minutes.toFixed(1)} />
          <Factor label={`${statShort}/min`} value={p.perMinute.toFixed(2)} />
          <Factor label="Matchup" value={mult(p.matchupFactor)} />
          {p.env.total !== null ? <Factor label="Game total" value={mult(p.env.totalFactor)} /> : <Factor label="Pace" value={mult(p.paceFactor)} />}
        </div>
        <p className="mt-2.5 text-[10px] leading-relaxed text-muted-foreground">
          Expected minutes × per-minute production × matchup × game environment, from {p.games}{" "}logged games, then blended with the
          market.{" "}
          <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
            How accurate is it?
          </Link>
        </p>
      </div>
    </section>
  );
}

type ChartWindow = "5" | "10" | "15" | "20" | "szn";
const CHART_WINDOWS: { key: ChartWindow; label: string }[] = [
  { key: "5", label: "L5" },
  { key: "10", label: "L10" },
  { key: "15", label: "L15" },
  { key: "20", label: "L20" },
  { key: "szn", label: "SZN" },
];

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
  defense,
  projection,
  modelWeights,
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
  defense: DefenseTable;
  /** Tonight's projection inputs (see nba/slateContext). */
  projection: ProjectionContext;
  /** Stat → the model's fitted weight against the market. */
  modelWeights: Record<string, number>;
  initialStat: NbaPropStat;
  side: PropDirection;
  startLabel: string;
  onClose: () => void;
}) {
  const [stat, setStat] = useState<NbaPropStat>(initialStat);
  const [chartWindow, setChartWindow] = useState<ChartWindow>("20");
  const [side, setSide] = useState<PropDirection>(initialSide);
  const prop = props.find((p) => p.stat === stat) ?? props[0];
  const statDef = NBA_PROP_STAT_BY_KEY.get(prop.stat)!;
  const consensus = propConsensusPoint(prop.quotes);
  const [pointByStat, setPointByStat] = useState<Partial<Record<NbaPropStat, number>>>({});
  const point = pointByStat[prop.stat] ?? consensus ?? prop.quotes[0]?.point ?? 0;

  const summary = useMemo(
    () => summarizeProp(prop, logs, statDef, side, {
          season,
          venue: player.venue,
          opponent: player.opponent?.abbreviation,
          projection,
          injury: player.injury?.level ?? null,
          modelWeight: modelWeights[prop.stat],
        },
        point
      ),
    [prop, logs, statDef, side, season, player.venue, player.opponent?.abbreviation, player.injury?.level, projection, modelWeights, point]
  );
  const books = useMemo(() => booksAtPoint(prop.quotes, point, side), [prop.quotes, point, side]);
  const pairs = useMemo(() => twoSidedAt(prop.quotes, point), [prop.quotes, point]);
  const fair = fairPrice(pairs);
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
              <p className="truncate text-base font-semibold text-foreground">
                {player.name}
                <InjuryBadge injury={player.injury} />
              </p>
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

          {player.injury?.level && (
            <p className={`rounded-lg px-3 py-2 text-xs ${player.injury.level === "out" || player.injury.level === "doubtful" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-amber-500/10 text-amber-800 dark:text-amber-200"}`}>
              <span className="font-semibold">{player.injury.status}</span>
              {player.injury.detail ? ` — ${player.injury.detail}` : ""}.{" "}
              {player.injury.level === "out" || player.injury.level === "doubtful"
                ? "No projection while he's listed this way; books usually pull his props."
                : "The projection's confidence is widened until he's cleared."}
            </p>
          )}

          {summary?.model && <ProjectionPanel model={summary.model} point={point} side={side} statShort={statDef.shortLabel} />}

          {summary && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hit rates</h3>
              <SplitGrid splits={summary.splits} />
            </section>
          )}

          {summary && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Matchup</h3>
              <MatchupPanel
                defense={defense}
                player={player}
                stat={statDef}
                side={side}
                h2h={summary.splits.find((sp) => sp.key === "h2h")}
                minutesL5={summary.avgMinutesL5}
                minutesSeason={summary.avgMinutesSeason}
              />
            </section>
          )}

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Game log</h3>
              <Segmented options={CHART_WINDOWS} value={chartWindow} onChange={setChartWindow} />
            </div>
            <GameLogChart
              key={chartWindow}
              logs={chartWindow === "szn" ? logs.filter((l) => l.season === season) : logs}
              stat={statDef}
              point={point}
              side={side}
              count={chartWindow === "szn" ? 82 : Number(chartWindow)}
            />
          </section>

          <section>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Every book at {point}</h3>
              {fair && (
                <span className="text-[11px] text-muted-foreground" title="The market's no-vig price: every book's two sides with the margin removed, averaged">
                  Fair{" "}
                  <span className="font-mono font-semibold text-foreground">
                    O {formatAmerican(Math.round(decimalToAmerican(1 / fair.probA)))} · U{" "}
                    {formatAmerican(Math.round(decimalToAmerican(1 / (1 - fair.probA))))}
                  </span>
                </span>
              )}
            </div>
            {books.length === 0 ? (
              <p className="text-sm text-muted-foreground">No book prices this number.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                <li className="grid grid-cols-[1fr_5.75rem_5.75rem] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <span>Book</span>
                  <span className="text-right">Over</span>
                  <span className="text-right">Under</span>
                </li>
                {books.map((b) => {
                  const best = b.bookKey === bestBook;
                  return (
                    <li
                      key={b.bookKey}
                      className={`grid grid-cols-[1fr_5.75rem_5.75rem] items-center px-3 py-2 ${best ? "bg-emerald-500/10" : ""} ${b.bettable ? "" : "opacity-60"}`}
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
                          className={`flex items-center justify-end gap-1 text-right font-mono text-sm ${s === side ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                        >
                          {s === side && b[s] !== null && b.bettable && (
                            <EvTag value={valueOf(pairs, s === "over" ? "A" : "B", b[s]!, b.bookKey)} className="text-[9px]" />
                          )}
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
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Last 10 games</h3>
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
