"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NflPropStat } from "@/generated/prisma/client";
import { NFL_PROP_STATS, NFL_PROP_STAT_BY_KEY, type NflPropStatDef } from "@/lib/nfl/propStats";
import { sortNflSummaries, summarizeNflProp, unpackNflLog, type NflLogPoint, type NflPropSort, type NflPropSummary, type NflSlateProp, type PackedNflLog } from "@/lib/nfl/propsMath";
import { nflStatMatchup, type NflDefenseTable } from "@/lib/nfl/matchup";
import { matchupGrade, ordinal } from "@/lib/nba/matchup";
import { booksAtPoint, propConsensusPoint, twoSidedAt } from "@/lib/nba/propsMath";
import { fairPrice, valueOf } from "@/lib/odds/marketValue";
import { decimalToAmerican, formatAmerican } from "@/lib/odds/americanOdds";
import type { NflPropsSlate, NflSlatePlayer } from "@/lib/queries/nflProps";
import type { SlateGame } from "@/lib/queries/nbaProps";
import type { PropDirection } from "@/lib/props/tally";
import { Logo } from "@/components/Logo";
import { BookBadge } from "@/components/BookBadge";
import { EvTag } from "@/components/EvTag";
import { InjuryBadge } from "@/components/InjuryBadge";
import type { Absence } from "@/lib/injuries/absence";
import { HitMeter, formatRate, rateTone } from "@/components/nba/HitMeter";
import { SplitGrid } from "@/components/nba/Matchup";
import { GameLogChart } from "@/components/nba/GameLogChart";

const SORTS: { key: NflPropSort; label: string }[] = [
  { key: "hitRate", label: "Hit rate" },
  { key: "value", label: "Market value" },
  { key: "model", label: "Model edge" },
  { key: "price", label: "Best price" },
];
const MODEL_EV_FLAG = 0.03;

function kickoff(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}
const initials = (n: string) => n.split(" ").map((p) => p[0]).join("").slice(0, 2);
const chip = (active: boolean) =>
  `shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`;
const toAmerican = (p: number) => formatAmerican(Math.round(decimalToAmerican(1 / p)));

function DefChip({ defense, player, stat, side }: { defense: NflDefenseTable; player: NflSlatePlayer; stat: NflPropStatDef; side: PropDirection }) {
  const m = player.opponent ? nflStatMatchup(defense, player.opponent.abbreviation, stat, player.position) : null;
  if (!m) return null;
  const g = matchupGrade(m.rank, m.of, side);
  const tone = g === "great" || g === "good" ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : g === "neutral" ? "bg-muted text-foreground" : "bg-red-500/10 text-red-700 dark:text-red-300";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 ${tone}`} title={`${player.opponent?.abbreviation} allows ${m.perGame.toFixed(1)} per game to ${m.position}s`}>
      <span className="text-[10px] font-semibold uppercase opacity-70">Def v {m.position}</span>
      <span className="font-mono font-semibold">{ordinal(m.rank)}</span>
    </span>
  );
}

function ModelChip({ s, side }: { s: NflPropSummary; side: PropDirection }) {
  if (!s.model) return null;
  const p = side === "over" ? s.model.probOver : s.model.probUnder;
  const ev = side === "over" ? s.model.evOver : s.model.evUnder;
  const edge = ev !== null && ev >= MODEL_EV_FLAG;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 ${edge ? "bg-brand text-brand-foreground" : "bg-muted"}`}>
      <span className={`text-[10px] font-semibold uppercase ${edge ? "" : "text-muted-foreground"}`}>Model</span>
      <span className={`font-mono font-semibold ${edge ? "" : "text-foreground"}`}>{Math.round(p * 100)}%</span>
    </span>
  );
}

function sideLabel(stat: NflPropStatDef, side: PropDirection): string {
  if (stat.shape === "anytime") return side === "over" ? "Yes" : "No";
  return side === "over" ? "O" : "U";
}

function PropCard({ s, player, game, side, stat, defense, onOpen }: { s: NflPropSummary; player: NflSlatePlayer; game?: SlateGame; side: PropDirection; stat: NflPropStatDef; defense: NflDefenseTable; onOpen: () => void }) {
  const best = side === "over" ? s.over : s.under;
  const value = side === "over" ? s.value.over : s.value.under;
  const strip = s.splits.filter((x) => x.key === "l3" || (x.key === "h2h" && x.rate.sampleSize > 0));
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full rounded-2xl border border-border bg-card p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <Logo sources={[player.headshotUrl]} alt={player.name} fallbackText={initials(player.name)} size={48} fit="cover" />
            {player.team && (
              <span className="absolute -bottom-1 -right-1">
                <Logo sources={[player.team.logoUrl]} alt={player.team.name} fallbackText={player.team.abbreviation} size={20} />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight text-foreground">
              {player.name}
              {player.position && <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">{player.position}</span>}
              <InjuryBadge injury={player.injury} />
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              {player.opponent && (
                <>
                  {player.venue === "home" ? "vs" : "@"}
                  <Logo sources={[player.opponent.logoUrl]} alt={player.opponent.name} fallbackText={player.opponent.abbreviation} size={14} />
                  {player.opponent.abbreviation}
                </>
              )}
              {game && <span>· {kickoff(game.startUtc)}</span>}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-xl font-semibold leading-none tracking-tight text-foreground">
              {stat.shape === "anytime" ? "TD" : s.point}
              {stat.shape !== "anytime" && <span className="ml-1 font-sans text-[10px] font-semibold text-muted-foreground">{stat.shortLabel}</span>}
            </p>
            {s.model && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                proj <span className="font-mono font-semibold text-foreground">{s.model.projection.mean.toFixed(stat.shape === "yards" ? 0 : 1)}</span>
                {s.avg !== null && <> · avg {s.avg.toFixed(stat.shape === "yards" ? 0 : 1)}</>}
              </p>
            )}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <HitMeter recent={s.recent.slice(0, 5)} rate={s.l5} window="L5" slots={5} />
          <div className="flex items-center gap-1.5">
            <EvTag value={value} />
            {best ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1 ring-1 ring-emerald-500/30">
                <span className="text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">{sideLabel(stat, side)}</span>
                <span className="font-mono text-sm font-semibold text-foreground">{formatAmerican(best.priceAmerican)}</span>
                <BookBadge bookKey={best.bookKey} bookName={best.bookName} size={18} />
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">no {side}</span>
            )}
          </div>
        </div>
        <div className="mt-2.5 flex items-center gap-3 overflow-x-auto whitespace-nowrap border-t border-border pt-2 text-[11px] text-muted-foreground [scrollbar-width:none]">
          {strip.map((x) => (
            <span key={x.key}>
              {x.label} <span className={`font-mono font-semibold ${rateTone(x.rate)}`}>{formatRate(x.rate)}</span>
            </span>
          ))}
          <span className="ml-auto flex items-center gap-2">
            <ModelChip s={s} side={side} />
            <DefChip defense={defense} player={player} stat={stat} side={side} />
          </span>
        </div>
      </button>
    </li>
  );
}

function Sheet({ player, props, logs, season, defense, absences, initialStat, side: initialSide, onClose }: { player: NflSlatePlayer; props: NflSlateProp[]; logs: NflLogPoint[]; season: number; defense: NflDefenseTable; absences?: Absence[]; initialStat: NflPropStat; side: PropDirection; onClose: () => void }) {
  const [statKey, setStatKey] = useState(initialStat);
  const [side, setSide] = useState(initialSide);
  const prop = props.find((p) => p.stat === statKey) ?? props[0];
  const stat = NFL_PROP_STAT_BY_KEY.get(prop.stat)!;
  const consensus = propConsensusPoint(prop.quotes);
  const [pointByStat, setPointByStat] = useState<Partial<Record<NflPropStat, number>>>({});
  const point = pointByStat[prop.stat] ?? consensus ?? prop.quotes[0]?.point ?? 0;
  const ctx = {
    season,
    venue: player.venue,
    opponent: player.opponent?.abbreviation ?? null,
    projection: { defense, opponent: player.opponent?.abbreviation ?? null, position: player.position, absences },
    injury: player.injury?.level ?? null,
  };
  const s = summarizeNflProp(prop, logs, stat, side, ctx, point);
  const books = booksAtPoint(prop.quotes, point, side);
  const pairs = twoSidedAt(prop.quotes, point);
  const fair = fairPrice(pairs);
  const bestBook = side === "over" ? s?.over?.bookKey : s?.under?.bookKey;
  const [win, setWin] = useState<"5" | "8" | "szn">("8");

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

  const offered = NFL_PROP_STATS.filter((x) => props.some((p) => p.stat === x.key));
  const m = s?.model;
  const ev = m ? (side === "over" ? m.evOver : m.evUnder) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`${player.name} props`}>
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-in fade-in-0" onClick={onClose} />
      <div className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-background shadow-2xl animate-in slide-in-from-bottom-8 duration-200 sm:max-w-lg sm:rounded-2xl">
        <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 pb-3 pt-2 backdrop-blur">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30 sm:hidden" aria-hidden />
          <div className="flex items-center gap-3">
            <Logo sources={[player.headshotUrl]} alt={player.name} fallbackText={initials(player.name)} size={56} fit="cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-foreground">
                {player.name} {player.position && <span className="text-xs font-medium text-muted-foreground">{player.position}</span>}
                <InjuryBadge injury={player.injury} />
              </p>
              <p className="text-xs text-muted-foreground">
                {player.venue === "home" ? "vs" : "@"} {player.opponent?.abbreviation} · {player.team?.name}
              </p>
            </div>
            <button ref={closeRef} type="button" onClick={onClose} className="rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close">
              <svg viewBox="0 0 16 16" fill="none" className="size-4" aria-hidden>
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {offered.length > 1 && (
            <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
              {offered.map((x) => (
                <button key={x.key} type="button" onClick={() => setStatKey(x.key)} className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${x.key === prop.stat ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
                  {x.shortLabel}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-5 px-4 pb-8 pt-4">
          <section className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="font-mono text-3xl font-semibold tracking-tight text-foreground">{stat.shape === "anytime" ? "Score a TD" : point}</p>
            </div>
            <div className="inline-flex rounded-lg bg-muted p-0.5">
              {(["over", "under"] as const).map((x) => (
                <button key={x} type="button" onClick={() => setSide(x)} className={`rounded-md px-3 py-1 text-xs font-semibold ${x === side ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
                  {stat.shape === "anytime" ? (x === "over" ? "Yes" : "No") : x === "over" ? "Over" : "Under"}
                </button>
              ))}
            </div>
          </section>
          {s && s.points.length > 1 && stat.shape !== "anytime" && (
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
              {s.points.map((p) => (
                <button key={p} type="button" onClick={() => setPointByStat((v) => ({ ...v, [prop.stat]: p }))} className={`shrink-0 rounded-md border px-2.5 py-1 font-mono text-xs font-semibold ${p === point ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground"}`}>
                  {p}
                  {p === consensus && <span className="ml-1 font-sans text-[9px] font-medium text-muted-foreground">MAIN</span>}
                </button>
              ))}
            </div>
          )}

          {player.injury?.level && (
            <p className={`rounded-lg px-3 py-2 text-xs ${player.injury.level === "out" || player.injury.level === "doubtful" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-amber-500/10 text-amber-800 dark:text-amber-200"}`}>
              <span className="font-semibold">{player.injury.status}</span>
              {player.injury.detail ? ` — ${player.injury.detail}` : ""}.{" "}
              {player.injury.level === "out" || player.injury.level === "doubtful"
                ? "No projection while he's listed this way; books usually pull his props."
                : "The projection's confidence is widened until he's cleared."}
            </p>
          )}

          {m && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-extrabold uppercase italic tracking-wide text-foreground">
                <span className="brand-slash" aria-hidden />
                ARCHR projection
              </h3>
              <div className="rounded-xl border border-border bg-card p-3.5">
                <div className="flex items-end justify-between gap-3">
                  <p className="font-mono text-3xl font-semibold leading-none text-foreground">
                    {stat.shape === "anytime" ? `${Math.round(m.probOver * 100)}%` : m.projection.mean.toFixed(stat.shape === "yards" ? 0 : 1)}
                    <span className="ml-1 font-sans text-xs font-semibold text-muted-foreground">{stat.shape === "anytime" ? "to score" : stat.shortLabel}</span>
                  </p>
                  <div className="text-right text-xs text-muted-foreground">
                    {stat.shape !== "anytime" && (
                      <p>
                        at {point}: <span className="font-mono font-semibold text-foreground">O {Math.round(m.probOver * 100)}%</span> ·{" "}
                        <span className="font-mono font-semibold text-foreground">U {Math.round(m.probUnder * 100)}%</span>
                      </p>
                    )}
                    {ev !== null && (
                      <p className={`mt-1 font-mono text-sm font-bold ${ev >= MODEL_EV_FLAG ? "text-emerald-600 dark:text-brand" : "text-muted-foreground"}`}>
                        {ev >= 0 ? "+" : ""}
                        {(ev * 100).toFixed(1)}% model EV
                      </p>
                    )}
                  </div>
                </div>
                {m.projection.absence && (
                  <p className="mt-3 rounded-lg bg-muted/60 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
                    <span className="font-semibold text-foreground">Without {m.projection.absence.names.join(" & ")}</span> (out this week):{" "}
                    {m.projection.absence.games} games averaging {m.projection.absence.perGame.toFixed(stat.shape === "yards" ? 0 : 1)} — blended in.
                  </p>
                )}
                <p className="mt-2.5 text-[10px] leading-relaxed text-muted-foreground">
                  Recent per-game production steadied by two seasons, × matchup {m.projection.matchupFactor.toFixed(2)}, from {m.projection.games}{" "}games. Check it against the
                  market&apos;s fair price below before trusting an edge.{" "}
          <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
            How accurate is it?
          </Link>
                </p>
              </div>
            </section>
          )}

          {s && (
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hit rates</h3>
              <SplitGrid splits={s.splits} />
            </section>
          )}

          {stat.shape !== "anytime" && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Game log</h3>
                <div className="inline-flex rounded-lg bg-muted p-0.5">
                  {(["5", "8", "szn"] as const).map((w) => (
                    <button key={w} type="button" onClick={() => setWin(w)} className={`rounded-md px-2.5 py-1 text-xs font-semibold ${w === win ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
                      {w === "szn" ? "SZN" : `L${w}`}
                    </button>
                  ))}
                </div>
              </div>
              <GameLogChart key={win} logs={win === "szn" ? logs.filter((l) => l.season === season) : logs} stat={stat} point={point} side={side} count={win === "szn" ? 20 : Number(win)} />
            </section>
          )}

          <section>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Every book</h3>
              {fair && (
                <span className="text-[11px] text-muted-foreground">
                  Fair <span className="font-mono font-semibold text-foreground">{sideLabel(stat, "over")} {toAmerican(fair.probA)} · {sideLabel(stat, "under")} {toAmerican(1 - fair.probA)}</span>
                </span>
              )}
            </div>
            {books.length === 0 ? (
              <p className="text-sm text-muted-foreground">No book prices this number.</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {books.map((b) => (
                  <li key={b.bookKey} className={`grid grid-cols-[1fr_5.75rem_5.75rem] items-center px-3 py-2 ${b.bookKey === bestBook ? "bg-emerald-500/10" : ""} ${b.bettable ? "" : "opacity-60"}`}>
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <BookBadge bookKey={b.bookKey} bookName={b.bookName} size={20} />
                      <span className="truncate">{b.bookName}</span>
                    </span>
                    {(["over", "under"] as const).map((x) => (
                      <span key={x} className={`flex items-center justify-end gap-1 font-mono text-sm ${x === side ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                        {x === side && b[x] !== null && b.bettable && <EvTag value={valueOf(pairs, x === "over" ? "A" : "B", b[x]!, b.bookKey)} className="text-[9px]" />}
                        {b[x] === null ? "—" : formatAmerican(b[x]!)}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * The NFL props finder: the week's props arrive once and every control — stat,
 * side, sort, game, search — recomputes in the browser.
 */
export function NflPropsFinder({ slate, initialGame = null, lockGame = false }: { slate: Omit<NflPropsSlate, "logs"> & { logs: Record<string, PackedNflLog[]> }; initialGame?: string | null; lockGame?: boolean }) {
  const [statKey, setStatKey] = useState<NflPropStat>("passYards");
  const [side, setSide] = useState<PropDirection>("over");
  const [sort, setSort] = useState<NflPropSort>("hitRate");
  const [gameId, setGameId] = useState<string | null>(initialGame);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const logs = useMemo(() => Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackNflLog)])) as Record<string, NflLogPoint[]>, [slate.logs]);
  const gameById = useMemo(() => new Map(slate.games.map((g) => [g.id, g])), [slate.games]);
  const stat = NFL_PROP_STAT_BY_KEY.get(statKey)!;
  const counts = useMemo(() => {
    const c = new Map<NflPropStat, number>();
    for (const p of slate.props) if (!gameId || slate.players[p.playerId]?.gameId === gameId) c.set(p.stat, (c.get(p.stat) ?? 0) + 1);
    return c;
  }, [slate.props, slate.players, gameId]);

  const summaries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const out: NflPropSummary[] = [];
    for (const prop of slate.props) {
      if (prop.stat !== statKey) continue;
      const player = slate.players[prop.playerId];
      if (!player || (gameId && player.gameId !== gameId) || (needle && !player.name.toLowerCase().includes(needle))) continue;
      const s = summarizeNflProp(prop, logs[prop.playerId] ?? [], stat, side, {
        season: slate.season,
        venue: player.venue,
        opponent: player.opponent?.abbreviation ?? null,
        projection: {
          defense: slate.defense,
          opponent: player.opponent?.abbreviation ?? null,
          position: player.position,
          absences: player.team ? slate.absences[player.team.abbreviation] : undefined,
        },
        injury: player.injury?.level ?? null,
      });
      if (s) out.push(s);
    }
    return sortNflSummaries(out, sort, side);
  }, [slate, logs, statKey, stat, side, sort, gameId, query]);

  const openPlayer = open ? slate.players[open] : null;

  return (
    <>
      <div className="sticky top-[45px] z-10 -mx-4 mt-4 border-b border-border bg-background/90 px-4 pb-2.5 pt-2.5 backdrop-blur-md">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]" role="tablist" aria-label="Stat">
          {NFL_PROP_STATS.filter((x) => counts.get(x.key)).map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={x.key === statKey} onClick={() => setStatKey(x.key)} className={chip(x.key === statKey)}>
              {x.shortLabel}
              <span className="ml-1 font-normal opacity-60">{counts.get(x.key)}</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="inline-flex shrink-0 rounded-lg bg-muted p-0.5">
            {(["over", "under"] as const).map((x) => (
              <button key={x} type="button" onClick={() => setSide(x)} className={`rounded-md px-3 py-1 text-xs font-semibold ${x === side ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
                {stat.shape === "anytime" ? (x === "over" ? "Yes" : "No") : x === "over" ? "Over" : "Under"}
              </button>
            ))}
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as NflPropSort)} className="h-7 rounded-lg bg-muted px-2 text-xs font-semibold text-foreground" aria-label="Sort">
            {SORTS.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Player" className="h-7 min-w-0 flex-1 rounded-lg bg-muted px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none" />
        </div>
      </div>

      {!lockGame && slate.games.length > 1 && (
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          <button type="button" onClick={() => setGameId(null)} className={chip(gameId === null)}>
            All games
          </button>
          {slate.games.map((g) => (
            <button key={g.id} type="button" onClick={() => setGameId(g.id === gameId ? null : g.id)} className={`${chip(g.id === gameId)} inline-flex items-center gap-1.5`}>
              <Logo sources={[g.away.logoUrl]} alt={g.away.name} fallbackText={g.away.abbreviation} size={16} />
              {g.away.abbreviation}
              <span className="opacity-50">@</span>
              <Logo sources={[g.home.logoUrl]} alt={g.home.name} fallbackText={g.home.abbreviation} size={16} />
              {g.home.abbreviation}
              <span className="font-normal opacity-60">{kickoff(g.startUtc)}</span>
            </button>
          ))}
        </div>
      )}

      {summaries.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">No {stat.label.toLowerCase()} props{query ? ` match “${query}”` : " priced"}.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {summaries.map((s) => (
            <PropCard key={s.playerId} s={s} player={slate.players[s.playerId]} game={gameById.get(slate.players[s.playerId].gameId)} side={side} stat={stat} defense={slate.defense} onOpen={() => setOpen(s.playerId)} />
          ))}
        </ul>
      )}

      {openPlayer && (
        <Sheet
          key={openPlayer.id}
          player={openPlayer}
          props={slate.props.filter((p) => p.playerId === openPlayer.id)}
          logs={logs[openPlayer.id] ?? []}
          season={slate.season}
          defense={slate.defense}
          absences={openPlayer.team ? slate.absences[openPlayer.team.abbreviation] : undefined}
          initialStat={statKey}
          side={side}
          onClose={close}
        />
      )}
    </>
  );
}
