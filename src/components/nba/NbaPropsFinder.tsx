"use client";

import { useCallback, useMemo, useState } from "react";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { NBA_PROP_STATS, NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { PROPS_PREFS_COOKIE, type PropsPrefs } from "@/lib/nba/propsPrefsShared";
import { sortSummaries, summarizeProp, unpackLog, type GameLogPoint, type PropSort, type PropSummary } from "@/lib/nba/propsMath";
import type { SlateGame, SlatePlayer, WireNbaPropsSlate } from "@/lib/queries/nbaProps";
import type { PropDirection } from "@/lib/props/tally";
import type { NbaPropStat } from "@/generated/prisma/client";
import { Logo } from "@/components/Logo";
import { BookBadge } from "@/components/BookBadge";
import { HitMeter, formatRate, rateTone } from "./HitMeter";
import { PlayerPropSheet } from "./PlayerPropSheet";
import { MatchupChip } from "./Matchup";
import { EvTag } from "@/components/EvTag";
import { InjuryBadge } from "@/components/InjuryBadge";
import type { DefenseTable } from "@/lib/nba/matchup";
import type { NbaPropStatDef } from "@/lib/nba/propStats";


const SORTS: { key: PropSort; label: string }[] = [
  { key: "hitRate", label: "Hit rate" },
  { key: "margin", label: "Avg vs line" },
  { key: "price", label: "Best price" },
  { key: "value", label: "Market value" },
  { key: "model", label: "Model edge" },
];

function startLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(
    new Date(iso)
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);
}

function chip(active: boolean): string {
  return `shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
    active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"
  }`;
}

/** ARCHR's chance for the chosen side, volt when the model sees an edge at the best price. */
function ModelChip({ summary, side }: { summary: PropSummary; side: PropDirection }) {
  const m = summary.model;
  if (!m) return null;
  const p = side === "over" ? m.probOver : m.probUnder;
  const ev = side === "over" ? m.evOver : m.evUnder;
  const edge = ev !== null && ev >= MODEL_EV_FLAG;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 ${edge ? "bg-brand text-brand-foreground" : "bg-muted"}`}
      title={ev === null ? undefined : `Model EV at the best price: ${(ev * 100).toFixed(1)}%`}
    >
      <span className={`text-[10px] font-semibold uppercase ${edge ? "" : "text-muted-foreground"}`}>Model</span>
      <span className={`font-mono font-semibold ${edge ? "" : "text-foreground"}`}>{Math.round(p * 100)}%</span>
    </span>
  );
}

/** The model must clear a wider bar than the market read: it's one opinion against the whole market. */
const MODEL_EV_FLAG = 0.03;

function PropCard({
  summary,
  player,
  game,
  side,
  stat,
  defense,
  onOpen,
}: {
  summary: PropSummary;
  player: SlatePlayer;
  game: SlateGame | undefined;
  side: PropDirection;
  stat: NbaPropStatDef;
  defense: DefenseTable;
  onOpen: () => void;
}) {
  const best = side === "over" ? summary.over : summary.under;
  const other = side === "over" ? summary.under : summary.over;
  const value = side === "over" ? summary.value.over : summary.value.under;
  const statShort = stat.shortLabel;
  const rates = summary.hitRates;
  // The card's split strip: short form, the season, and head-to-head when they've met (every window is in the sheet).
  const cardSplits = summary.splits.filter(
    (sp) => ["l3", "l5", "season"].includes(sp.key) || (sp.key === "h2h" && sp.rate.sampleSize > 0)
  );
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="group w-full rounded-2xl border border-border bg-card p-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:-translate-y-0.5 hover:border-foreground/15 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
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
              <InjuryBadge injury={player.injury} />
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              {player.opponent ? (
                <>
                  {player.venue === "home" ? "vs" : "@"}
                  <Logo sources={[player.opponent.logoUrl]} alt={player.opponent.name} fallbackText={player.opponent.abbreviation} size={14} />
                  {player.opponent.abbreviation}
                </>
              ) : (
                game && `${game.away.abbreviation} @ ${game.home.abbreviation}`
              )}
              {game && <span>· {startLabel(game.startUtc)}</span>}
              {summary.avgMinutesL5 !== null && <span className="hidden sm:inline">· {Math.round(summary.avgMinutesL5)} min</span>}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="font-mono text-xl font-semibold leading-none tracking-tight text-foreground">
              {summary.point}
              <span className="ml-1 font-sans text-[10px] font-semibold text-muted-foreground">{statShort}</span>
            </p>
            {summary.model ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                proj <span className="font-mono font-semibold text-foreground">{summary.model.projection.mean.toFixed(1)}</span>
                {summary.avgL10 !== null && <> · avg {summary.avgL10.toFixed(1)}</>}
              </p>
            ) : (
              summary.avgL10 !== null && <p className="mt-1 text-[11px] text-muted-foreground">avg {summary.avgL10.toFixed(1)} L10</p>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <HitMeter recent={summary.recent} rate={rates.l10} />
          <div className="flex items-center gap-1.5">
            <EvTag value={value} />
            {best ? (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1 ring-1 ring-emerald-500/30">
                <span className="text-[10px] font-bold uppercase text-emerald-700 dark:text-emerald-300">{side === "over" ? "O" : "U"}</span>
                <span className="font-mono text-sm font-semibold text-foreground">{formatAmerican(best.priceAmerican)}</span>
                <BookBadge bookKey={best.bookKey} bookName={best.bookName} size={18} />
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">no {side}</span>
            )}
            {other && (
              <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
                {side === "over" ? "U" : "O"} <span className="font-mono">{formatAmerican(other.priceAmerican)}</span>
              </span>
            )}
          </div>
        </div>

        <div className="mt-2.5 flex items-center gap-3 overflow-x-auto whitespace-nowrap border-t border-border pt-2 text-[11px] text-muted-foreground [scrollbar-width:none]">
          {cardSplits.map((sp) => (
            <span key={sp.key}>
              {sp.label} <span className={`font-mono font-semibold ${rateTone(sp.rate)}`}>{formatRate(sp.rate)}</span>
            </span>
          ))}
          <span className="ml-auto flex items-center gap-2">
            <ModelChip summary={summary} side={side} />
            <MatchupChip defense={defense} opponent={player.opponent?.abbreviation} stat={stat} side={side} group={player.positionGroup} />
            <span className="hidden sm:inline">
              {summary.booksAtLine} book{summary.booksAtLine === 1 ? "" : "s"}
              {summary.points.length > 1 && ` · ${summary.points.length - 1} alt`}
            </span>
          </span>
        </div>
      </button>
    </li>
  );
}

/**
 * The NBA props finder: the whole day's slate arrives once and every control —
 * stat, Over/Under, sort, game, search — recomputes in the browser instantly.
 * Choices are mirrored into the URL (shareable) and a cookie (remembered).
 */
export function NbaPropsFinder({
  slate,
  initial,
  initialGame,
  lockGame = false,
}: {
  slate: WireNbaPropsSlate;
  initial: PropsPrefs;
  initialGame: string | null;
  /** On a game page: stay on that game, with no game strip and no URL rewriting. */
  lockGame?: boolean;
}) {
  const [prefs, setPrefs] = useState<PropsPrefs>(initial);
  const [gameId, setGameId] = useState<string | null>(initialGame);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const update = useCallback(
    (change: Partial<PropsPrefs> & { game?: string | null }) => {
      const next = { ...prefs, ...change };
      const game = change.game !== undefined ? change.game : gameId;
      setPrefs(next);
      if (change.game !== undefined) setGameId(change.game);
      if (!lockGame) {
        const qs = new URLSearchParams({ date: slate.date, stat: next.stat, side: next.side, sort: next.sort });
        if (game) qs.set("game", game);
        window.history.replaceState(null, "", `?${qs.toString()}`);
      }
      document.cookie = `${PROPS_PREFS_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=31536000; samesite=lax`;
    },
    [prefs, gameId, slate.date, lockGame]
  );

  const statDef = NBA_PROP_STAT_BY_KEY.get(prefs.stat)!;
  // Unpacked once per slate; every control after that recomputes from these.
  const logs = useMemo(
    () => Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackLog)])) as Record<string, GameLogPoint[]>,
    [slate.logs]
  );
  const gameById = useMemo(() => new Map(slate.games.map((g) => [g.id, g])), [slate.games]);
  const statCounts = useMemo(() => {
    const counts = new Map<NbaPropStat, number>();
    for (const p of slate.props) {
      if (gameId && slate.players[p.playerId]?.gameId !== gameId) continue;
      counts.set(p.stat, (counts.get(p.stat) ?? 0) + 1);
    }
    return counts;
  }, [slate.props, slate.players, gameId]);

  const summaries = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const out: PropSummary[] = [];
    for (const prop of slate.props) {
      if (prop.stat !== prefs.stat) continue;
      const player = slate.players[prop.playerId];
      if (!player || (gameId && player.gameId !== gameId)) continue;
      if (needle && !player.name.toLowerCase().includes(needle)) continue;
      const s = summarizeProp(prop, logs[prop.playerId] ?? [], statDef, prefs.side, {
        season: slate.season,
        venue: player.venue,
        opponent: player.opponent?.abbreviation,
        projection: {
          defense: slate.defense,
          opponent: player.opponent?.abbreviation ?? null,
          positionGroup: player.positionGroup,
          absences: player.team ? slate.absences[player.team.abbreviation] : undefined,
        },
        injury: player.injury?.level ?? null,
      });
      if (s) out.push(s);
    }
    return sortSummaries(out, prefs.sort, prefs.side);
  }, [slate, logs, prefs, gameId, query, statDef]);

  const openPlayer = open ? slate.players[open] : null;
  // Stable, so the sheet's open/close effect (focus, scroll lock) runs once per opening.
  const closeSheet = useCallback(() => setOpen(null), []);

  return (
    <>
      {/* Sticky controls: stat strip, then side / sort / search. */}
      <div className="sticky top-[45px] z-10 -mx-4 mt-4 border-b border-border bg-background/90 px-4 pb-2.5 pt-2.5 backdrop-blur-md">
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]" role="tablist" aria-label="Stat">
          {NBA_PROP_STATS.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              aria-selected={s.key === prefs.stat}
              onClick={() => update({ stat: s.key })}
              className={chip(s.key === prefs.stat)}
            >
              {s.shortLabel}
              {statCounts.get(s.key) ? (
                <span className={`ml-1 font-normal ${s.key === prefs.stat ? "opacity-70" : "opacity-60"}`}>{statCounts.get(s.key)}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="inline-flex shrink-0 rounded-lg bg-muted p-0.5">
            {(["over", "under"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => update({ side: s })}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
                  s === prefs.side ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {s === "over" ? "Over" : "Under"}
              </button>
            ))}
          </div>
          <label className="relative shrink-0">
            <span className="sr-only">Sort</span>
            <select
              value={prefs.sort}
              onChange={(e) => update({ sort: e.target.value as PropSort })}
              className="h-7 appearance-none rounded-lg bg-muted py-0 pl-2.5 pr-7 text-xs font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
            <svg viewBox="0 0 12 12" className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" aria-hidden>
              <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </label>
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search players</span>
            <svg viewBox="0 0 16 16" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden>
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Player"
              className="h-7 w-full rounded-lg bg-muted pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
        </div>
      </div>

      {!lockGame && slate.games.length > 1 && (
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          <button type="button" onClick={() => update({ game: null })} className={chip(gameId === null)}>
            All games
          </button>
          {slate.games.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => update({ game: g.id === gameId ? null : g.id })}
              className={`${chip(g.id === gameId)} inline-flex items-center gap-1.5`}
            >
              <Logo sources={[g.away.logoUrl]} alt={g.away.name} fallbackText={g.away.abbreviation} size={16} />
              {g.away.abbreviation}
              <span className="opacity-50">@</span>
              <Logo sources={[g.home.logoUrl]} alt={g.home.name} fallbackText={g.home.abbreviation} size={16} />
              {g.home.abbreviation}
              <span className="font-normal opacity-60">{startLabel(g.startUtc)}</span>
            </button>
          ))}
        </div>
      )}

      <p className="mt-4 text-xs text-muted-foreground">
        {`${summaries.length} ${statDef.label} ${summaries.length === 1 ? "prop" : "props"} · ${
          prefs.side === "over" ? "Over" : "Under"
        } hit rates at each player's main line · tap a player for every line and book`}
      </p>

      {summaries.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">
            {query ? `No ${statDef.label.toLowerCase()} props match “${query}”` : `No ${statDef.label.toLowerCase()} props priced`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Try another stat{slate.games.length > 1 ? " or game" : ""}.</p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {summaries.map((s) => (
            <PropCard
              key={s.playerId}
              summary={s}
              player={slate.players[s.playerId]}
              game={gameById.get(slate.players[s.playerId].gameId)}
              side={prefs.side}
              stat={statDef}
              defense={slate.defense}
              onOpen={() => setOpen(s.playerId)}
            />
          ))}
        </ul>
      )}

      {openPlayer && (
        <PlayerPropSheet
          key={openPlayer.id}
          player={openPlayer}
          props={slate.props.filter((p) => p.playerId === openPlayer.id)}
          logs={logs[openPlayer.id] ?? []}
          season={slate.season}
          defense={slate.defense}
          absences={openPlayer.team ? slate.absences[openPlayer.team.abbreviation] : undefined}
          initialStat={prefs.stat}
          side={prefs.side}
          startLabel={(() => {
            const g = gameById.get(openPlayer.gameId);
            return g ? `${startLabel(g.startUtc)} ET` : "";
          })()}
          onClose={closeSheet}
        />
      )}
    </>
  );
}
