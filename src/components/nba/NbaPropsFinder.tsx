"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import { nbaProjectionContext } from "@/lib/nba/slateContext";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { NBA_PROP_STATS, NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { PROPS_PREFS_COOKIE, type PropsPrefs } from "@/lib/nba/propsPrefsShared";
import { sortSummaries, summarizeProp, unpackLog, type GameLogPoint, type PropSort, type PropSummary } from "@/lib/nba/propsMath";
import type { SlateGame, SlatePlayer, WireNbaPropsSlate } from "@/lib/queries/nbaProps";
import type { PropDirection } from "@/lib/props/tally";
import type { NbaPropStat } from "@/generated/prisma/client";
import { Logo } from "@/components/Logo";
import { ArchrLineChip, BestPriceChip, EmptyList, GameChips, ListNote, ModelChip, ProjectedDivider, PropCard, PropsControls } from "@/components/props/kit";
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

/** The model must clear a wider bar than the market read: it's one opinion against the whole market. */
const MODEL_EV_FLAG = 0.03;

/** Below this many games this season, the card shows last season's rate beside it. */
const EARLY_SEASON_GAMES = 10;

function NbaCard({
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
  // The card's split strip: short form, this season, and head-to-head when they've met (every window is in the sheet).
  // While this season is only a handful of games, last season rides along so a 3-for-3 start
  // isn't the only "season" number on the card.
  const earlySeason = rates.season.sampleSize < EARLY_SEASON_GAMES && rates.lastSeason.sampleSize > 0;
  const cardSplits = summary.splits.filter(
    (sp) =>
      (earlySeason ? ["l5", "season", "lastSeason"] : ["l3", "l5", "season"]).includes(sp.key) ||
      (sp.key === "h2h" && sp.rate.sampleSize > 0)
  );
  const m = summary.model;
  const modelProb = m ? (side === "over" ? m.probOver : m.probUnder) : null;
  const modelEv = m ? (side === "over" ? m.evOver : m.evUnder) : null;
  return (
    <PropCard
      onOpen={onOpen}
      headshot={[player.headshotUrl]}
      name={player.name}
      badges={<InjuryBadge injury={player.injury} />}
      teamLogo={player.team?.logoUrl}
      teamAbbr={player.team?.abbreviation}
      sub={
        <>
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
        </>
      }
      value={summary.point}
      unit={statShort}
      under={
        summary.model ? (
          <>
            proj <span className="font-mono font-semibold text-foreground">{summary.model.projection.mean.toFixed(1)}</span>
            {summary.avgL10 !== null && <> · avg {summary.avgL10.toFixed(1)}</>}
          </>
        ) : summary.avgL10 !== null ? (
          <>avg {summary.avgL10.toFixed(1)} L10</>
        ) : null
      }
      meter={<HitMeter recent={summary.recent} rate={rates.l10} />}
      price={
        <>
          {summary.projected ? <ArchrLineChip /> : <EvTag value={value} />}
          {summary.projected ? null : best ? (
            <BestPriceChip sideLabel={side === "over" ? "O" : "U"} price={best.priceAmerican} bookKey={best.bookKey} bookName={best.bookName} />
          ) : (
            <span className="text-xs text-muted-foreground">no {side}</span>
          )}
          {other && (
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              {side === "over" ? "U" : "O"} <span className="font-mono">{formatAmerican(other.priceAmerican)}</span>
            </span>
          )}
        </>
      }
      strip={cardSplits.map((sp) => (
        <span key={sp.key}>
          {sp.label} <span className={`font-mono font-semibold ${rateTone(sp.rate)}`}>{formatRate(sp.rate)}</span>
          {/* A season window can be a few games or eighty: say which. */}
          {(sp.key === "season" || sp.key === "lastSeason") && sp.rate.sampleSize > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground"> {sp.rate.hits}/{sp.rate.sampleSize}</span>
          )}
        </span>
      ))}
      stripRight={
        <>
          {!summary.projected && modelProb !== null && <ModelChip prob={modelProb} edge={modelEv !== null && modelEv >= MODEL_EV_FLAG} />}
          <MatchupChip defense={defense} opponent={player.opponent?.abbreviation} stat={stat} side={side} group={player.positionGroup} />
          <span className={summary.projected ? "hidden" : "hidden sm:inline"}>
            {summary.booksAtLine} book{summary.booksAtLine === 1 ? "" : "s"}
            {summary.points.length > 1 && ` · ${summary.points.length - 1} alt`}
          </span>
        </>
      }
    />
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
        projection: nbaProjectionContext(slate, player),
        injury: player.injury?.level ?? null,
        modelWeight: slate.modelWeights[prop.stat],
      });
      if (s) out.push(s);
    }
    return sortSummaries(out, prefs.sort, prefs.side);
  }, [slate, logs, prefs, gameId, query, statDef]);
  const posted = summaries.filter((s) => !s.projected);

  const openPlayer = open ? slate.players[open] : null;
  // Stable, so the sheet's open/close effect (focus, scroll lock) runs once per opening.
  const closeSheet = useCallback(() => setOpen(null), []);

  return (
    <>
      <PropsControls
        stats={NBA_PROP_STATS.filter((s) => statCounts.get(s.key) || s.key === prefs.stat).map((s) => ({ key: s.key, label: s.shortLabel, count: statCounts.get(s.key) }))}
        stat={prefs.stat}
        onStat={(stat) => update({ stat })}
        side={prefs.side}
        onSide={(side) => update({ side })}
        sorts={SORTS}
        sort={prefs.sort}
        onSort={(sort) => update({ sort })}
        query={query}
        onQuery={setQuery}
      />

      {!lockGame && (
        <GameChips
          games={slate.games.map((g) => ({ id: g.id, away: g.away, home: g.home, start: startLabel(g.startUtc) }))}
          active={gameId}
          onSelect={(game) => update({ game })}
        />
      )}

      <ListNote>
        {posted.length > 0
          ? `${posted.length} ${statDef.label} ${posted.length === 1 ? "prop" : "props"} posted · ${prefs.side === "over" ? "Over" : "Under"} hit rates at each player's main line · tap a player for every game, line and book`
          : `Books haven't posted ${statDef.label.toLowerCase()} props yet — below is ARCHR's line for every rotation player. Tap one for every game against it.`}
      </ListNote>

      {summaries.length === 0 ? (
        <EmptyList
          title={query ? `No ${statDef.label.toLowerCase()} props match “${query}”` : `No ${statDef.label.toLowerCase()} props priced`}
          hint={`Try another stat${slate.games.length > 1 ? " or game" : ""}.`}
        />
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {summaries.map((s, i) => (
            <Fragment key={s.playerId}>
            {s.projected && posted.length > 0 && (i === 0 || !summaries[i - 1]!.projected) && <ProjectedDivider />}
            <NbaCard
              summary={s}
              player={slate.players[s.playerId]}
              game={gameById.get(slate.players[s.playerId].gameId)}
              side={prefs.side}
              stat={statDef}
              defense={slate.defense}
              onOpen={() => setOpen(s.playerId)}
            />
            </Fragment>
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
          projection={nbaProjectionContext(slate, openPlayer)}
          modelWeights={slate.modelWeights}
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
