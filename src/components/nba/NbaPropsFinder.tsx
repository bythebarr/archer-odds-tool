"use client";

import { Fragment, useCallback, useMemo, useState } from "react";
import { nbaProjectionContext } from "@/lib/nba/slateContext";
import { NBA_PROP_STATS, NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { PROPS_PREFS_COOKIE, type PropsPrefs } from "@/lib/nba/propsPrefsShared";
import { sortSummaries, summarizeProp, unpackLog, type GameLogPoint, type PropSort, type PropSummary } from "@/lib/nba/propsMath";
import type { SlateGame, SlatePlayer, WireNbaPropsSlate } from "@/lib/queries/nbaProps";
import type { PropDirection } from "@/lib/props/tally";
import type { NbaPropStat } from "@/generated/prisma/client";
import { EmptyList, GameChips, ListNote, ProjectedDivider, PropEdgeCard, PropsControls } from "@/components/props/kit";
import { PlayerPropSheet } from "./PlayerPropSheet";
import { ParlayTray } from "@/components/props/Parlay";
import { addLeg, type ParlayLeg } from "@/lib/props/parlay";
import type { FrozenPrices } from "@/lib/queries/oddsFeed";
import { trackRecordLabel } from "@/lib/modelBadge";
import { nbaSummaryConfidence } from "@/lib/propModel/summaryConfidence";
import { InjuryBadge } from "@/components/InjuryBadge";
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

function NbaCard({
  summary,
  player,
  game,
  side,
  stat,
  blendVerdict,
  blendGraded,
  frozen,
  onOpen,
}: {
  summary: PropSummary;
  player: SlatePlayer;
  game: SlateGame | undefined;
  side: PropDirection;
  stat: NbaPropStatDef;
  /** The blend card's verdict for this stat (absent stat = no card). */
  blendVerdict?: string | null;
  /** Outcomes that card was graded on. */
  blendGraded?: number;
  frozen?: FrozenPrices;
  onOpen: () => void;
}) {
  const best = side === "over" ? summary.over : summary.under;
  const value = side === "over" ? summary.value.over : summary.value.under;
  const m = summary.model;
  const modelEv = m ? (side === "over" ? m.evOver : m.evUnder) : null;
  const priced = !summary.projected && !!best;
  // The edge: ARCHR's, else the books' own no-vig EV on rows ARCHR doesn't price; none on a line with no price.
  const edge = !priced ? null : modelEv !== null ? modelEv : (value?.ev ?? null);
  const matchup = player.opponent ? `${player.team?.abbreviation ?? ""} ${player.venue === "home" ? "vs" : "@"} ${player.opponent.abbreviation}`.trim() : game ? `${game.away.abbreviation} @ ${game.home.abbreviation}` : null;
  return (
    <PropEdgeCard
      onSelect={onOpen}
      headshot={[player.headshotUrl]}
      name={player.name}
      teamLogo={player.team?.logoUrl}
      teamAbbr={player.team?.abbreviation}
      label={
        <>
          {player.name} {side === "over" ? "Over" : "Under"} {summary.point} {stat.shortLabel}
          <InjuryBadge injury={player.injury} />
        </>
      }
      edge={edge}
      edgeBasis={modelEv !== null ? "archr" : "market"}
      chance={m ? { label: "ARCHR", value: side === "over" ? m.probOver : m.probUnder } : null}
      price={priced ? best!.priceAmerican : null}
      book={priced ? { key: best!.bookKey, name: best!.bookName } : null}
      confidence={nbaSummaryConfidence(summary, side, { blendVerdict: blendVerdict ?? null, injury: player.injury?.level ?? null, alt: false })}
      frozen={priced ? frozen : null}
      whisper={[summary.projected ? "ARCHR's own line, no book line yet" : null, matchup, game ? startLabel(game.startUtc) : null, m ? trackRecordLabel(blendVerdict, blendGraded) : null].filter(Boolean).join(" · ")}
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
  frozen = null,
}: {
  slate: WireNbaPropsSlate;
  initial: PropsPrefs;
  initialGame: string | null;
  /** On a game page: stay on that game, with no game strip and no URL rewriting. */
  lockGame?: boolean;
  /** Set while the odds feed is frozen: prices grey out, dated. */
  frozen?: FrozenPrices;
}) {
  const [prefs, setPrefs] = useState<PropsPrefs>(initial);
  const [gameId, setGameId] = useState<string | null>(initialGame);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [parlay, setParlay] = useState<ParlayLeg[]>([]);

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
        calibrationFactor: slate.calibrationFactors?.[prop.stat],
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
              blendVerdict={slate.blendVerdicts[prefs.stat]}
              blendGraded={slate.blendGraded?.[prefs.stat]}
              frozen={frozen}
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
          calibrationFactors={slate.calibrationFactors ?? {}}
          blendVerdicts={slate.blendVerdicts}
          blendGraded={slate.blendGraded}
          initialStat={prefs.stat}
          side={prefs.side}
          startLabel={(() => {
            const g = gameById.get(openPlayer.gameId);
            return g ? `${startLabel(g.startUtc)} ET` : "";
          })()}
          parlay={parlay}
          onAddLeg={(leg) => setParlay((legs) => addLeg(legs, leg))}
          onClose={closeSheet}
        />
      )}
      <ParlayTray legs={parlay} season={slate.season} onRemove={(id) => setParlay((legs) => legs.filter((l) => l.id !== id))} onClear={() => setParlay([])} />
    </>
  );
}
