"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SOCCER_PROP_STATS,
  SOCCER_PROP_STAT_BY_KEY,
  fairAmerican,
  projectedMean,
  projectionOver,
  soccerLine,
  soccerSplits,
  unpackSoccerLog,
  type PackedSoccerLog,
  type SoccerLog,
  type SoccerPropStat,
  type SoccerPropStatDef,
} from "@/lib/soccer/propModel";
import type { SoccerPropsPlayer, SoccerPropsSlate } from "@/lib/queries/soccerProps";
import type { PropDirection } from "@/lib/props/tally";
import { tallyPropHits } from "@/lib/props/tally";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { Logo } from "@/components/Logo";
import { LeagueLogo } from "@/components/allSports/LeagueLogo";
import { HitMeter } from "@/components/nba/HitMeter";
import { SplitGrid } from "@/components/nba/Matchup";
import { PropGameChart } from "@/components/props/PropGameChart";

type Sort = "chance" | "projection" | "hitRate";
const SORTS: { key: Sort; label: string }[] = [
  { key: "chance", label: "ARCHR chance" },
  { key: "projection", label: "Projection" },
  { key: "hitRate", label: "L10 hit rate" },
];
const POSITION_LABEL = { G: "GK", D: "DEF", M: "MID", F: "FWD" } as const;

function kickoff(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}
/** ESPN's headshot when it has one, then his Wikipedia photo (the route 404s to initials). */
const photoSources = (p: SoccerPropsPlayer) => [...(p.headshotUrl ? [p.headshotUrl] : []), `/api/soccer/player-photo?id=${encodeURIComponent(p.id)}`];
const initials = (n: string) => n.split(" ").map((p) => p[0]).join("").slice(0, 2);
const short = (team: string) => team.replace(/^(AFC|FC|CF|SC|AC|AS|SS|SV|VfB|VfL|RC|RCD|CA|CD|UD|SD)\s+/i, "").split(" ").slice(0, 2).join(" ");
const chip = (active: boolean) =>
  `shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`;
const sideWord = (stat: SoccerPropStatDef, side: PropDirection) => (stat.shape === "anytime" ? (side === "over" ? "Yes" : "No") : side === "over" ? "Over" : "Under");
const pct = (p: number) => `${Math.round(p * 100)}%`;
const digits = (stat: SoccerPropStatDef) => (stat.shape === "anytime" ? 2 : 1);

interface Row {
  player: SoccerPropsPlayer;
  point: number;
  chance: number;
  mean: number;
  l10: ReturnType<typeof tallyPropHits>;
  recent: boolean[];
}

function rowFor(player: SoccerPropsPlayer, stat: SoccerPropStatDef, side: PropDirection, logs: SoccerLog[], point?: number): Row | null {
  const proj = player.projections[stat.key];
  if (!proj) return null;
  const at = point ?? soccerLine(stat, proj);
  const over = projectionOver(proj, at, stat);
  const played = logs.filter((l) => l.minutes > 0).slice(0, 10);
  const values = played.map(stat.value);
  return {
    player,
    point: at,
    chance: side === "over" ? over : 1 - over,
    mean: projectedMean(proj),
    l10: tallyPropHits(values, at, side),
    recent: values.map((v) => (side === "over" ? v > at : v < at)).reverse(),
  };
}

function PropCard({ row, stat, side, startsAt, onOpen }: { row: Row; stat: SoccerPropStatDef; side: PropDirection; startsAt?: string; onOpen: () => void }) {
  const { player } = row;
  const proj = player.projections[stat.key]!;
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full rounded-2xl border border-border bg-card p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <Logo sources={photoSources(player)} alt={player.name} fallbackText={initials(player.name)} size={48} fit="cover" />
            <span className="absolute -bottom-1 -right-1">
              <Logo sources={[player.teamLogo]} alt={player.team} fallbackText={initials(player.team)} size={20} />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight text-foreground">
              {player.name}
              <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">{POSITION_LABEL[player.position]}</span>
            </p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
              {player.venue === "home" ? "vs" : "@"}
              <Logo sources={[player.opponentLogo]} alt={player.opponent} fallbackText={initials(player.opponent)} size={14} />
              <span className="truncate">{short(player.opponent)}</span>
              {startsAt && <span className="shrink-0">· {kickoff(startsAt)}</span>}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-xl font-semibold leading-none tracking-tight text-foreground">
              {stat.shape === "anytime" ? pct(row.chance) : row.point}
              <span className="ml-1 font-sans text-[10px] font-semibold text-muted-foreground">{stat.shape === "anytime" ? (side === "over" ? stat.shortLabel : `NO ${stat.shortLabel}`) : stat.shortLabel}</span>
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              proj <span className="font-mono font-semibold text-foreground">{row.mean.toFixed(digits(stat))}</span> · {Math.round(proj.minutes)}′
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <HitMeter recent={row.recent} rate={row.l10} window="L10" slots={10} />
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand/10 px-2 py-1 ring-1 ring-brand/40" title="ARCHR's fair price; books' prices land here when they post">
            <span className="text-[10px] font-bold uppercase text-foreground">{stat.shape === "anytime" ? sideWord(stat, side) : `${side === "over" ? "O" : "U"} ${pct(row.chance)}`}</span>
            <span className="font-mono text-sm font-semibold text-foreground">{formatAmerican(fairAmerican(row.chance))}</span>
            <span className="text-[9px] font-semibold uppercase text-muted-foreground">fair</span>
          </span>
        </div>
        {player.lineup && (
          <p className={`mt-2 text-[11px] font-semibold ${player.lineup === "starting" ? "text-emerald-600 dark:text-brand" : "text-amber-700 dark:text-amber-300"}`}>
            {player.lineup === "starting" ? "✓ In the starting XI" : "On the bench"}
          </p>
        )}
      </button>
    </li>
  );
}

function Sheet({ player, initialStat, side: initialSide, season, cardLogs, onClose }: { player: SoccerPropsPlayer; initialStat: SoccerPropStat; side: PropDirection; season: number; cardLogs: SoccerLog[]; onClose: () => void }) {
  const offered = SOCCER_PROP_STATS.filter((s) => player.projections[s.key]);
  const [statKey, setStatKey] = useState<SoccerPropStat>(player.projections[initialStat] ? initialStat : offered[0]!.key);
  const [side, setSide] = useState(initialSide);
  const [pointByStat, setPointByStat] = useState<Partial<Record<SoccerPropStat, number>>>({});
  const [fullLogs, setFullLogs] = useState<SoccerLog[] | null>(null);
  const stat = SOCCER_PROP_STAT_BY_KEY.get(statKey)!;
  const proj = player.projections[statKey]!;
  const main = soccerLine(stat, proj);
  const point = pointByStat[statKey] ?? main;
  const logs = fullLogs ?? cardLogs;
  const over = projectionOver(proj, point, stat);
  const chance = side === "over" ? over : 1 - over;
  const splits = soccerSplits(logs, stat, point, side, { season, venue: player.venue, opponent: player.opponent });
  const ladder = stat.shape === "anytime" ? [] : [0.5, 1.5, 2.5, 3.5, 4.5, 5.5].filter((p) => p <= Math.max(2.5, main + 2));

  useEffect(() => {
    let live = true;
    fetch(`/api/soccer/player-logs?id=${encodeURIComponent(player.id)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { logs?: PackedSoccerLog[] } | null) => {
        if (live && j?.logs) setFullLogs(j.logs.map(unpackSoccerLog));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [player.id]);

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

  const playedLogs = logs.filter((l) => l.minutes > 0).map((l) => ({ ...l, volume: l.minutes }));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`${player.name} props`}>
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/50 backdrop-blur-[2px] animate-in fade-in-0" onClick={onClose} />
      <div className="relative max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-border bg-background shadow-2xl animate-in slide-in-from-bottom-8 duration-200 sm:max-w-lg sm:rounded-2xl">
        <div className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 pb-3 pt-2 backdrop-blur">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-muted-foreground/30 sm:hidden" aria-hidden />
          <div className="flex items-center gap-3">
            <Logo sources={photoSources(player)} alt={player.name} fallbackText={initials(player.name)} size={56} fit="cover" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-semibold text-foreground">
                {player.name} <span className="text-xs font-medium text-muted-foreground">{POSITION_LABEL[player.position]}</span>
              </p>
              <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                <Logo sources={[player.teamLogo]} alt={player.team} fallbackText={initials(player.team)} size={14} />
                {player.team} {player.venue === "home" ? "vs" : "@"} {player.opponent}
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
                <button key={x.key} type="button" onClick={() => setStatKey(x.key)} className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${x.key === statKey ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
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
              <p className="font-mono text-3xl font-semibold tracking-tight text-foreground">{stat.shape === "anytime" ? stat.label.replace(/^Anytime /, "").replace(/^To be /, "") : point}</p>
            </div>
            <div className="inline-flex rounded-lg bg-muted p-0.5">
              {(["over", "under"] as const).map((x) => (
                <button key={x} type="button" onClick={() => setSide(x)} className={`rounded-md px-3 py-1 text-xs font-semibold ${x === side ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
                  {sideWord(stat, x)}
                </button>
              ))}
            </div>
          </section>

          <p className="rounded-lg bg-brand/10 px-3 py-2 text-xs leading-relaxed text-foreground ring-1 ring-brand/30">
            <span className="font-semibold">ARCHR&apos;s price.</span> {stat.shape === "anytime" ? "" : <>{main} is ARCHR&apos;s line, where Over and Under are closest to even. </>}
            Books&apos; prices land here when they post this prop, with the edge against ARCHR&apos;s.
          </p>

          <section>
            <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-extrabold uppercase italic tracking-wide text-foreground">
              <span className="brand-slash" aria-hidden />
              {stat.label} by match
            </h3>
            <PropGameChart
              logs={playedLogs}
              value={(l) => stat.value(l)}
              statShort={stat.shortLabel}
              point={point}
              side={side}
              season={season}
              projection={proj.mean}
              opponent={player.opponent}
              venue={player.venue}
              volumeLabel="min"
              lineLabel="ARCHR line"
            />
            {!fullLogs && <p className="mt-1 text-[11px] text-muted-foreground">Loading every match…</p>}
          </section>
          {ladder.length > 1 && (
            <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
              {ladder.map((p) => {
                const o = projectionOver(proj, p, stat);
                return (
                  <button key={p} type="button" onClick={() => setPointByStat((v) => ({ ...v, [statKey]: p }))} className={`shrink-0 rounded-md border px-2.5 py-1 text-left ${p === point ? "border-primary bg-primary/10" : "border-border"}`}>
                    <span className="block font-mono text-xs font-semibold text-foreground">
                      {side === "over" ? "O" : "U"} {p}
                      {p === main && <span className="ml-1 font-sans text-[9px] font-medium text-muted-foreground">MAIN</span>}
                    </span>
                    <span className="block font-mono text-[10px] text-muted-foreground">{formatAmerican(fairAmerican(side === "over" ? o : 1 - o))}</span>
                  </button>
                );
              })}
            </div>
          )}

          <section>
            <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-extrabold uppercase italic tracking-wide text-foreground">
              <span className="brand-slash" aria-hidden />
              ARCHR projection
            </h3>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-end justify-between gap-3">
                <p className="font-mono text-3xl font-semibold leading-none text-foreground">
                  {pct(chance)}
                  <span className="ml-1 font-sans text-xs font-semibold text-muted-foreground">{stat.shape === "anytime" ? sideWord(stat, side).toLowerCase() : `${side} ${point}`}</span>
                </p>
                <div className="text-right text-xs text-muted-foreground">
                  <p>
                    fair <span className="font-mono text-sm font-bold text-foreground">{formatAmerican(fairAmerican(chance))}</span>
                  </p>
                  <p className="mt-0.5">
                    avg tonight <span className="font-mono font-semibold text-foreground">{projectedMean(proj).toFixed(digits(stat))}</span>
                  </p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                {[
                  ["Plays", pct(proj.playProb)],
                  ["Minutes", `${Math.round(proj.minutes)}′`],
                  ["Per 90", proj.rate90.toFixed(2)],
                  ["Matchup", `×${proj.factor.toFixed(2)}`],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-muted/60 px-1 py-1.5">
                    <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{k}</dt>
                    <dd className="font-mono text-sm font-semibold text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2.5 text-[10px] leading-relaxed text-muted-foreground">
                {player.lineup === "starting"
                  ? "Confirmed in the starting XI: minutes from his recent starts. "
                  : player.lineup === "bench"
                    ? "Named on the bench: priced on his minutes off the bench, about an even chance he comes on. "
                    : "Chance to play and minutes from his team's last six matches. "}
                His per-90 rate across recent matches (every competition, recent ones weighted up) is steadied toward his position&apos;s average, then scaled by{" "}
                {stat.matchup === "keeper" ? "the opponent's shots on target lately" : stat.matchup === "attack" ? "what the opponent has allowed lately" : "nothing — fouls and cards follow the player"} and home or away.{" "}
                <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
                  How accurate is it?
                </Link>
              </p>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hit rates at {stat.shape === "anytime" ? sideWord(stat, side) : `${side} ${point}`}</h3>
            <SplitGrid splits={splits} />
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Every book</h3>
            <p className="text-sm text-muted-foreground">Books haven&apos;t posted this prop here yet — every book&apos;s price lands here when they do.</p>
          </section>
        </div>
      </div>
    </div>
  );
}

/**
 * Soccer player props for one league: every stat, every player with a role in
 * the next matches, ARCHR's line and chance on each. Controls recompute in the
 * browser; tapping a player opens his sheet with every match charted.
 */
export function SoccerPropsFinder({ slate, initialMatch = null }: { slate: SoccerPropsSlate; initialMatch?: string | null }) {
  const [statKey, setStatKey] = useState<SoccerPropStat>("goal");
  const [side, setSide] = useState<PropDirection>("over");
  const [sort, setSort] = useState<Sort>("chance");
  const [matchId, setMatchId] = useState<string | null>(slate.matches.some((m) => m.id === initialMatch) ? initialMatch : null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const logs = useMemo(() => Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackSoccerLog)])) as Record<string, SoccerLog[]>, [slate.logs]);
  const matchById = useMemo(() => new Map(slate.matches.map((m) => [m.id, m])), [slate.matches]);
  const stat = SOCCER_PROP_STAT_BY_KEY.get(statKey)!;
  const counts = useMemo(() => {
    const c = new Map<SoccerPropStat, number>();
    for (const p of Object.values(slate.players)) {
      if (matchId && p.matchId !== matchId) continue;
      for (const k of Object.keys(p.projections) as SoccerPropStat[]) c.set(k, (c.get(k) ?? 0) + 1);
    }
    return c;
  }, [slate.players, matchId]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const out: Row[] = [];
    for (const p of Object.values(slate.players)) {
      if ((matchId && p.matchId !== matchId) || (needle && !p.name.toLowerCase().includes(needle) && !p.team.toLowerCase().includes(needle))) continue;
      const r = rowFor(p, stat, side, logs[p.id] ?? []);
      if (r) out.push(r);
    }
    const key = (r: Row) => (sort === "chance" ? r.chance : sort === "projection" ? (side === "over" ? r.mean : -r.mean) : (r.l10.hitRate ?? -1) + r.chance / 100);
    return out.sort((a, b) => key(b) - key(a)).slice(0, 150);
  }, [slate.players, logs, stat, side, sort, matchId, query]);

  const openPlayer = open ? slate.players[open] : null;

  return (
    <>
      {slate.leagues.length > 1 && (
        <nav aria-label="Leagues" className="-mx-4 mt-4 overflow-x-auto px-4 [scrollbar-width:none]">
          <ul className="flex gap-2">
            {slate.leagues.map((l) => (
              <li key={l.id} className="shrink-0">
                <Link
                  href={`/sports/soccer/props?league=${encodeURIComponent(l.slug)}`}
                  className={`flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-xs font-semibold ${l.id === slate.league?.id ? "border-foreground bg-foreground text-background" : "border-border bg-card text-foreground hover:border-foreground/40"}`}
                >
                  <LeagueLogo name={l.name} region={l.region} logoUrl={l.logoUrl} size={22} />
                  <span className="max-w-[10rem] truncate">{l.name}</span>
                  <span className="font-mono text-[10px] opacity-60">{l.matches}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="sticky top-[45px] z-10 -mx-4 mt-3 border-b border-border bg-background/90 px-4 pb-2.5 pt-2.5 backdrop-blur-md">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]" role="tablist" aria-label="Stat">
          {SOCCER_PROP_STATS.filter((x) => counts.get(x.key)).map((x) => (
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
                {sideWord(stat, x)}
              </button>
            ))}
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="h-7 rounded-lg bg-muted px-2 text-xs font-semibold text-foreground" aria-label="Sort">
            {SORTS.map((x) => (
              <option key={x.key} value={x.key}>
                {x.label}
              </option>
            ))}
          </select>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Player or team" className="h-7 min-w-0 flex-1 rounded-lg bg-muted px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none" />
        </div>
      </div>

      {slate.matches.length > 1 && (
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          <button type="button" onClick={() => setMatchId(null)} className={chip(matchId === null)}>
            All matches
          </button>
          {slate.matches.map((m) => (
            <button key={m.id} type="button" onClick={() => setMatchId(m.id === matchId ? null : m.id)} className={`${chip(m.id === matchId)} inline-flex items-center gap-1.5`}>
              <Logo sources={[m.home.logo]} alt={m.home.name} fallbackText={initials(m.home.name)} size={16} />
              {short(m.home.name)}
              <span className="opacity-50">v</span>
              <Logo sources={[m.away.logo]} alt={m.away.name} fallbackText={initials(m.away.name)} size={16} />
              {short(m.away.name)}
              <span className="font-normal opacity-60">{kickoff(m.startsAt)}</span>
              {m.lineups && <span className="rounded bg-emerald-500/20 px-1 text-[9px] font-bold text-emerald-700 dark:text-emerald-300">XI</span>}
            </button>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          ARCHR&apos;s {stat.shape === "anytime" ? "chance and fair price" : "line and chance"} for every player with a role · tap a player for every match, line and split
        </p>
      )}
      {rows.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">No {stat.label.toLowerCase()} props{query ? ` match “${query}”` : " for these matches yet"}.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {rows.map((r) => (
            <PropCard key={r.player.id} row={r} stat={stat} side={side} startsAt={matchById.get(r.player.matchId)?.startsAt} onOpen={() => setOpen(r.player.id)} />
          ))}
        </ul>
      )}

      {openPlayer && <Sheet key={openPlayer.id} player={openPlayer} initialStat={statKey} side={side} season={slate.season} cardLogs={logs[openPlayer.id] ?? []} onClose={close} />}
    </>
  );
}
