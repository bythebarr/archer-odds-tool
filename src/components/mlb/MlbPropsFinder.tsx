"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MlbPropStat } from "@/lib/mlb/propProjection";
import {
  MLB_PROP_STATS,
  MLB_PROP_STAT_BY_KEY,
  mlbProjectedLine,
  mlbSplits,
  priceMlbLine,
  roleLogs,
  unpackMlbLog,
  type MlbChartLog,
  type MlbPropStatDef,
} from "@/lib/mlb/propsSlate";
import type { MlbPropsPlayer, MlbPropsSlate, MlbSlateProp } from "@/lib/queries/mlbProps";
import { booksAtPoint, propConsensusPoint, twoSidedAt } from "@/lib/nba/propsMath";
import { fairPrice, valueOf } from "@/lib/odds/marketValue";
import { decimalToAmerican, formatAmerican } from "@/lib/odds/americanOdds";
import { tallyPropHits, type PropDirection } from "@/lib/props/tally";
import { Logo } from "@/components/Logo";
import { BookBadge } from "@/components/BookBadge";
import { EvTag } from "@/components/EvTag";
import { HitMeter } from "@/components/nba/HitMeter";
import { SplitGrid } from "@/components/nba/Matchup";
import { PropGameChart } from "@/components/props/PropGameChart";

type Sort = "ev" | "chance" | "projection" | "hitRate";
const SORTS: { key: Sort; label: string }[] = [
  { key: "chance", label: "ARCHR chance" },
  { key: "ev", label: "Edge vs book" },
  { key: "projection", label: "Projection" },
  { key: "hitRate", label: "L10 hit rate" },
];
const EDGE_FLAG = 0.03;

const initials = (n: string) => n.split(" ").map((p) => p[0]).join("").slice(0, 2);
const chip = (active: boolean) =>
  `shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`;
const pct = (p: number) => `${Math.round(p * 100)}%`;
const fair = (p: number) => formatAmerican(Math.round(decimalToAmerican(1 / Math.min(0.995, Math.max(0.005, p)))));
function firstPitch(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}

interface Row {
  prop: MlbSlateProp;
  player: MlbPropsPlayer;
  point: number;
  projected: boolean;
  chance: number;
  ev: number | null;
  best: { price: number; bookKey: string; bookName: string } | null;
  l10: ReturnType<typeof tallyPropHits>;
  recent: boolean[];
}

function rowFor(prop: MlbSlateProp, player: MlbPropsPlayer, stat: MlbPropStatDef, side: PropDirection, logs: MlbChartLog[], at?: number): Row {
  const consensus = propConsensusPoint(prop.quotes);
  const point = at ?? consensus ?? prop.quotes[0]?.point ?? mlbProjectedLine(prop.projection.distribution, prop.projection.mean);
  const priced = priceMlbLine(prop.projection.distribution, prop.quotes, point, prop.stat);
  const sideQuotes = prop.quotes.filter((q) => q.point === point && q.side === side);
  const top = sideQuotes.reduce<(typeof sideQuotes)[number] | null>((b, q) => (!b || q.priceAmerican > b.priceAmerican ? q : b), null);
  const games = roleLogs(logs, stat.role).slice(0, 10);
  const values = games.map(stat.value);
  return {
    prop,
    player,
    point,
    projected: prop.quotes.length === 0,
    chance: side === "over" ? priced.probOver : priced.probUnder,
    ev: side === "over" ? priced.evOver : priced.evUnder,
    best: top ? { price: top.priceAmerican, bookKey: top.bookKey, bookName: top.bookName } : null,
    l10: tallyPropHits(values, point, side),
    recent: values.map((v) => (side === "over" ? v > point : v < point)).reverse(),
  };
}

function PropCard({ row, stat, side, startUtc, onOpen }: { row: Row; stat: MlbPropStatDef; side: PropDirection; startUtc?: string; onOpen: () => void }) {
  const { player } = row;
  const edge = row.ev !== null && row.ev >= EDGE_FLAG;
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full rounded-2xl border border-border bg-card p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-start gap-3">
          <div className="relative shrink-0">
            <Logo sources={[player.headshotUrl]} alt={player.name} fallbackText={initials(player.name)} size={48} fit="cover" />
            <span className="absolute -bottom-1 -right-1">
              <Logo sources={player.team.logoUrl ? [player.team.logoUrl] : []} alt={player.team.name} fallbackText={player.team.abbreviation} size={20} />
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight text-foreground">
              {player.name}
              <span className="ml-1.5 text-[11px] font-medium text-muted-foreground">{player.role === "pitcher" ? "SP" : player.battingOrder ? `#${player.battingOrder}` : "BAT"}</span>
            </p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
              {player.venue === "home" ? "vs" : "@"}
              <Logo sources={player.opponent.logoUrl ? [player.opponent.logoUrl] : []} alt={player.opponent.name} fallbackText={player.opponent.abbreviation} size={14} />
              {player.opponent.abbreviation}
              {player.role === "batter" && player.opposingStarter && (
                <span className="truncate">
                  · vs {player.opposingStarter.split(" ").at(-1)} ({player.opposingHand ?? "?"})
                </span>
              )}
              {startUtc && <span className="shrink-0">· {firstPitch(startUtc)}</span>}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-xl font-semibold leading-none tracking-tight text-foreground">
              {row.point}
              <span className="ml-1 font-sans text-[10px] font-semibold text-muted-foreground">{stat.shortLabel}</span>
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              proj <span className="font-mono font-semibold text-foreground">{row.prop.projection.mean.toFixed(stat.key === "outsRecorded" ? 1 : 2)}</span>
            </p>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <HitMeter recent={row.recent} rate={row.l10} window="L10" slots={10} />
          <div className="flex items-center gap-1.5">
            {row.projected ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-brand/10 px-2 py-1 ring-1 ring-brand/40" title="ARCHR's line and fair price; books' prices land here when they post">
                <span className="text-[10px] font-bold uppercase text-foreground">
                  {side === "over" ? "O" : "U"} {pct(row.chance)}
                </span>
                <span className="font-mono text-sm font-semibold text-foreground">{fair(row.chance)}</span>
                <span className="text-[9px] font-semibold uppercase text-muted-foreground">fair</span>
              </span>
            ) : row.best ? (
              <span className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ring-1 ${edge ? "bg-brand text-brand-foreground ring-brand" : "bg-emerald-500/10 ring-emerald-500/30"}`}>
                <span className="text-[10px] font-bold uppercase">
                  {side === "over" ? "O" : "U"} {pct(row.chance)}
                </span>
                <span className="font-mono text-sm font-semibold">{formatAmerican(row.best.price)}</span>
                <BookBadge bookKey={row.best.bookKey} bookName={row.best.bookName} size={18} />
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">no {side}</span>
            )}
          </div>
        </div>
        {row.ev !== null && !row.projected && (
          <p className={`mt-2 text-[11px] font-semibold ${edge ? "text-emerald-600 dark:text-brand" : "text-muted-foreground"}`}>
            {row.ev >= 0 ? "+" : ""}
            {(row.ev * 100).toFixed(1)}% EV at the best price
          </p>
        )}
      </button>
    </li>
  );
}

function Sheet({ player, props, logs, season, initialStat, side: initialSide, onClose }: { player: MlbPropsPlayer; props: MlbSlateProp[]; logs: MlbChartLog[]; season: number; initialStat: MlbPropStat; side: PropDirection; onClose: () => void }) {
  const offered = MLB_PROP_STATS.filter((s) => props.some((p) => p.stat === s.key));
  const [statKey, setStatKey] = useState<MlbPropStat>(props.some((p) => p.stat === initialStat) ? initialStat : offered[0]!.key);
  const [side, setSide] = useState(initialSide);
  const [pointBy, setPointBy] = useState<Partial<Record<MlbPropStat, number>>>({});
  const stat = MLB_PROP_STAT_BY_KEY.get(statKey)!;
  const prop = props.find((p) => p.stat === statKey)!;
  const proj = prop.projection;
  const main = propConsensusPoint(prop.quotes) ?? prop.quotes[0]?.point ?? mlbProjectedLine(proj.distribution, proj.mean);
  const point = pointBy[statKey] ?? main;
  const row = rowFor(prop, player, stat, side, logs, point);
  const priced = priceMlbLine(proj.distribution, prop.quotes, point, statKey);
  const books = booksAtPoint(prop.quotes, point, side);
  const pairs = twoSidedAt(prop.quotes, point);
  const market = fairPrice(pairs);
  const posted = [...new Set(prop.quotes.map((q) => q.point))].sort((a, b) => a - b);
  const ladder = [...new Set([...posted, ...[0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5].filter((p) => Math.abs(p - main) <= 2.5)])].sort((a, b) => a - b);
  const splits = mlbSplits(logs, stat, point, side, { season, venue: player.venue, opponent: player.opponent.abbreviation, hand: player.opposingHand });
  const chartLogs = roleLogs(logs, stat.role).map((l) => ({ ...l, volume: stat.role === "batter" ? (l.plateAppearances ?? undefined) : (l.outsRecorded ?? undefined) }));

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
                {player.name} <span className="text-xs font-medium text-muted-foreground">{player.role === "pitcher" ? "Starting pitcher" : player.battingOrder ? `Batting ${player.battingOrder}` : "Batter"}</span>
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {player.team.name} {player.venue === "home" ? "vs" : "@"} {player.opponent.name}
                {player.role === "batter" && player.opposingStarter ? ` · facing ${player.opposingStarter} (${player.opposingHand ?? "?"}HP)` : ""}
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
              <p className="font-mono text-3xl font-semibold tracking-tight text-foreground">{point}</p>
            </div>
            <div className="inline-flex rounded-lg bg-muted p-0.5">
              {(["over", "under"] as const).map((x) => (
                <button key={x} type="button" onClick={() => setSide(x)} className={`rounded-md px-3 py-1 text-xs font-semibold ${x === side ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}>
                  {x === "over" ? "Over" : "Under"}
                </button>
              ))}
            </div>
          </section>

          {row.projected && (
            <p className="rounded-lg bg-brand/10 px-3 py-2 text-xs leading-relaxed text-foreground ring-1 ring-brand/30">
              <span className="font-semibold">No book has posted this yet.</span> {main} is ARCHR&apos;s line, where Over and Under are closest to even. Books&apos; lines and
              prices replace it the moment they post.
            </p>
          )}

          <section>
            <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-extrabold uppercase italic tracking-wide text-foreground">
              <span className="brand-slash" aria-hidden />
              {stat.label} by game
            </h3>
            <PropGameChart
              logs={chartLogs}
              value={(l) => stat.value(l)}
              statShort={stat.shortLabel}
              point={point}
              side={side}
              season={season}
              projection={proj.mean}
              opponent={player.opponent.abbreviation}
              venue={player.venue}
              volumeLabel={stat.role === "batter" ? "PA" : "outs"}
              lineLabel={row.projected ? "ARCHR line" : "Line"}
            />
          </section>
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]">
            {ladder.map((p) => {
              const pr = priceMlbLine(proj.distribution, prop.quotes, p, statKey);
              const c = side === "over" ? pr.probOver : pr.probUnder;
              return (
                <button key={p} type="button" onClick={() => setPointBy((v) => ({ ...v, [statKey]: p }))} className={`shrink-0 rounded-md border px-2.5 py-1 text-left ${p === point ? "border-primary bg-primary/10" : "border-border"}`}>
                  <span className="block font-mono text-xs font-semibold text-foreground">
                    {side === "over" ? "O" : "U"} {p}
                    {p === main && <span className="ml-1 font-sans text-[9px] font-medium text-muted-foreground">MAIN</span>}
                  </span>
                  <span className="block font-mono text-[10px] text-muted-foreground">
                    {pct(c)} · {fair(c)}
                  </span>
                </button>
              );
            })}
          </div>

          <section>
            <h3 className="mb-2 flex items-center gap-2 font-display text-sm font-extrabold uppercase italic tracking-wide text-foreground">
              <span className="brand-slash" aria-hidden />
              ARCHR projection
            </h3>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex items-end justify-between gap-3">
                <p className="font-mono text-3xl font-semibold leading-none text-foreground">
                  {pct(side === "over" ? priced.probOver : priced.probUnder)}
                  <span className="ml-1 font-sans text-xs font-semibold text-muted-foreground">
                    {side} {point}
                  </span>
                </p>
                <div className="text-right text-xs text-muted-foreground">
                  <p>
                    fair <span className="font-mono text-sm font-bold text-foreground">{fair(side === "over" ? priced.probOver : priced.probUnder)}</span>
                  </p>
                  <p className="mt-0.5">
                    proj <span className="font-mono font-semibold text-foreground">{proj.mean.toFixed(2)}</span>
                  </p>
                  {row.ev !== null && (
                    <p className={`mt-0.5 font-mono text-sm font-bold ${row.ev >= EDGE_FLAG ? "text-emerald-600 dark:text-brand" : "text-muted-foreground"}`}>
                      {row.ev >= 0 ? "+" : ""}
                      {(row.ev * 100).toFixed(1)}% EV
                    </p>
                  )}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                {[
                  [stat.role === "batter" ? "Exp. PA" : "Exp. BF", proj.volume.toFixed(1)],
                  [stat.role === "batter" ? "Per PA" : "Per BF", proj.rate !== null ? proj.rate.toFixed(3) : "—"],
                  [stat.role === "batter" ? "Platoon" : "Opp K%", stat.role === "batter" ? `×${proj.platoonFactor.toFixed(2)}` : `×${proj.matchupFactor.toFixed(2)}`],
                  ["Games", String(proj.games)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-lg bg-muted/60 px-1 py-1.5">
                    <dt className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{k}</dt>
                    <dd className="font-mono text-sm font-semibold text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>
              {priced.market && (
                <p className="mt-2.5 text-[11px] text-muted-foreground">
                  Model {pct(side === "over" ? priced.modelProbOver : 1 - priced.modelProbOver)} · market {pct(side === "over" ? priced.market.probOver : 1 - priced.market.probOver)} · blended at {Math.round(priced.modelWeight * 100)}% model
                </p>
              )}
              <p className="mt-2.5 text-[10px] leading-relaxed text-muted-foreground">
                {stat.role === "batter"
                  ? "His per-plate-appearance rate over two seasons (recent games weighted up), steadied toward the league, × his split against tonight's starter's hand and the starter's strikeout rate, over a spread of plate appearances."
                  : "His per-batter rates over his recent starts, steadied toward the league, × the opposing lineup's strikeout rate, over a spread of batters faced."}{" "}
                <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
                  How accurate is it?
                </Link>
              </p>
            </div>
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Hit rates at {side} {point}
            </h3>
            <SplitGrid splits={splits} />
          </section>

          <section>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Every book</h3>
              {market && (
                <span className="text-[11px] text-muted-foreground">
                  No-vig <span className="font-mono font-semibold text-foreground">O {fair(market.probA)} · U {fair(1 - market.probA)}</span>
                </span>
              )}
            </div>
            {books.length === 0 ? (
              <p className="text-sm text-muted-foreground">{row.projected ? "Books haven't posted this prop yet — every book's price lands here when they do." : "No book prices this number."}</p>
            ) : (
              <ul className="divide-y divide-border rounded-xl border border-border">
                {books.map((b) => (
                  <li key={b.bookKey} className={`grid grid-cols-[1fr_5.75rem_5.75rem] items-center px-3 py-2 ${b.bettable ? "" : "opacity-60"}`}>
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
 * The MLB props finder: the day's batters and starters, every stat, ARCHR's
 * chance at the books' line (or its own line before they post). Controls
 * recompute in the browser; tap a player for his sheet.
 */
export function MlbPropsFinder({ slate }: { slate: MlbPropsSlate }) {
  const [statKey, setStatKey] = useState<MlbPropStat>("hits");
  const [side, setSide] = useState<PropDirection>("over");
  const [sort, setSort] = useState<Sort>("chance");
  const [gameId, setGameId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const logs = useMemo(() => Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackMlbLog)])) as Record<string, MlbChartLog[]>, [slate.logs]);
  const gameById = useMemo(() => new Map(slate.games.map((g) => [g.id, g])), [slate.games]);
  const stat = MLB_PROP_STAT_BY_KEY.get(statKey)!;
  const counts = useMemo(() => {
    const c = new Map<MlbPropStat, number>();
    for (const p of slate.props) if (!gameId || slate.players[p.playerId]?.gameId === gameId) c.set(p.stat, (c.get(p.stat) ?? 0) + 1);
    return c;
  }, [slate.props, slate.players, gameId]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const out: Row[] = [];
    for (const prop of slate.props) {
      if (prop.stat !== statKey) continue;
      const player = slate.players[prop.playerId];
      if (!player || (gameId && player.gameId !== gameId) || (needle && !player.name.toLowerCase().includes(needle))) continue;
      out.push(rowFor(prop, player, stat, side, logs[prop.playerId] ?? []));
    }
    const key = (r: Row) =>
      sort === "chance" ? r.chance : sort === "ev" ? (r.ev ?? -1) : sort === "projection" ? (side === "over" ? r.prop.projection.mean : -r.prop.projection.mean) : (r.l10.hitRate ?? -1) + r.chance / 100;
    // Posted lines first, then ARCHR's own.
    return out.sort((a, b) => Number(a.projected) - Number(b.projected) || key(b) - key(a));
  }, [slate, logs, statKey, stat, side, sort, gameId, query]);
  const posted = rows.filter((r) => !r.projected).length;
  const openPlayer = open ? slate.players[open] : null;

  return (
    <>
      <div className="sticky top-[45px] z-10 -mx-4 mt-4 border-b border-border bg-background/90 px-4 pb-2.5 pt-2.5 backdrop-blur-md">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]" role="tablist" aria-label="Stat">
          {MLB_PROP_STATS.filter((x) => counts.get(x.key)).map((x) => (
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
                {x === "over" ? "Over" : "Under"}
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
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Player" className="h-7 min-w-0 flex-1 rounded-lg bg-muted px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none" />
        </div>
      </div>

      {slate.games.length > 1 && (
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          <button type="button" onClick={() => setGameId(null)} className={chip(gameId === null)}>
            All games
          </button>
          {slate.games.map((g) => (
            <button key={g.id} type="button" onClick={() => setGameId(g.id === gameId ? null : g.id)} className={`${chip(g.id === gameId)} inline-flex items-center gap-1.5`}>
              <Logo sources={g.away.logoUrl ? [g.away.logoUrl] : []} alt={g.away.name} fallbackText={g.away.abbreviation} size={16} />
              {g.away.abbreviation}
              <span className="opacity-50">@</span>
              <Logo sources={g.home.logoUrl ? [g.home.logoUrl] : []} alt={g.home.name} fallbackText={g.home.abbreviation} size={16} />
              {g.home.abbreviation}
              <span className="font-normal opacity-60">{firstPitch(g.startUtc)}</span>
            </button>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          {posted > 0 ? `${posted} ${stat.label.toLowerCase()} props posted · ` : `Books haven't posted ${stat.label.toLowerCase()} yet — ARCHR's line for every ${stat.role === "pitcher" ? "starter" : "batter"} · `}
          tap a player for every game, line and book
        </p>
      )}
      {rows.length === 0 ? (
        <p className="mt-8 text-center text-sm text-muted-foreground">No {stat.label.toLowerCase()} props{query ? ` match “${query}”` : ""}.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {rows.map((r) => (
            <PropCard key={r.player.id} row={r} stat={stat} side={side} startUtc={gameById.get(r.player.gameId)?.startUtc} onOpen={() => setOpen(r.player.id)} />
          ))}
        </ul>
      )}

      {openPlayer && (
        <Sheet key={openPlayer.id} player={openPlayer} props={slate.props.filter((p) => p.playerId === openPlayer.id)} logs={logs[openPlayer.id] ?? []} season={slate.season} initialStat={statKey} side={side} onClose={close} />
      )}
    </>
  );
}
