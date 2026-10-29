"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { NBA_PROP_STATS, NBA_PROP_STAT_BY_KEY } from "@/lib/nba/propStats";
import { NBA_ALT_COLUMNS, altLinePointsNba, altLineRows, booksAtPoint, propConsensusPoint, summarizeProp, twoSidedAt, type GameLogPoint, type PropModel, type SlateProp } from "@/lib/nba/propsMath";
import { fairPrice } from "@/lib/odds/marketValue";
import { InjuryBadge } from "@/components/InjuryBadge";
import type { ProjectionContext } from "@/lib/nba/projection";
import type { SlatePlayer } from "@/lib/queries/nbaProps";
import type { PropDirection } from "@/lib/props/tally";
import type { NbaPropStat } from "@/generated/prisma/client";
import { Logo } from "@/components/Logo";
import { BlendLine, EnvLine, SeasonMixLine, signed } from "@/components/props/ModelPieces";
import { BooksTable, LinePicker, PlayerSheet, ProjectedNote, ProjectionCard, RecentGames, SheetFooter, SheetSection } from "@/components/props/kit";
import { PropGameChart } from "@/components/props/PropGameChart";
import { MatchupPanel, SplitGrid } from "./Matchup";
import { AltLinesTable } from "@/components/props/AltLinesTable";
import { ParlayButton } from "@/components/props/Parlay";
import type { ParlayLeg } from "@/lib/props/parlay";
import type { DefenseTable } from "@/lib/nba/matchup";

/** ARCHR's projection for this prop: the number, each side's chance at this line, model EV, and what built it. */
function ProjectionPanel({ model, point, side, statShort, milestone = false }: { model: PropModel; point: number; side: PropDirection; statShort: string; milestone?: boolean }) {
  const p = model.projection;
  const ev = side === "over" ? model.evOver : model.evUnder;
  const mult = (x: number) => `×${x.toFixed(2)}`;
  return (
    <ProjectionCard
      headline={milestone ? `${Math.round(model.probOver * 100)}%` : p.mean.toFixed(1)}
      unit={milestone ? `${statShort} chance` : statShort}
      swing={milestone ? "10+ in enough of PTS · REB · AST · STL · BLK" : `± ${p.sd.toFixed(1)} typical swing`}
      point={point}
      probOver={model.probOver}
      ev={ev}
      factors={[
        { label: "Minutes", value: p.minutes.toFixed(1) },
        { label: `${statShort}/min`, value: p.perMinute.toFixed(2) },
        { label: "Matchup", value: mult(p.matchupFactor) },
        p.env.total !== null ? { label: "Game total", value: mult(p.env.totalFactor) } : { label: "Pace", value: mult(p.paceFactor) },
      ]}
      footnote={
        <>
          Expected minutes × per-minute production × matchup × game environment, from {p.games}{" "}logged games, then blended with the market.{" "}
          <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
            How accurate is it?
          </Link>
        </>
      }
    >
      <BlendLine model={model} side={side} />
      <SeasonMixLine seasons={p.seasons} />
      <EnvLine
        parts={[...(p.env.total !== null ? [`total ${p.env.total}`] : []), ...(p.env.spread !== null ? [`spread ${signed(p.env.spread)}`] : [])]}
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
    </ProjectionCard>
  );
}

/**
 * Everything about one player's props in one panel: switch stat, pick any line
 * (the books' and ARCHR's alt ladder above and below the main one), see the hit
 * rates and the last 20 games against it, and every book's price at that line. A bottom sheet on phones, a centered dialog wider up.
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
  parlay,
  onAddLeg,
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
  /** The parlay being built on this page, and how to add this line to it. */
  parlay: ParlayLeg[];
  onAddLeg: (leg: ParlayLeg) => void;
  onClose: () => void;
}) {
  const [stat, setStat] = useState<NbaPropStat>(initialStat);
  const [side, setSide] = useState<PropDirection>(initialSide);
  const prop = props.find((p) => p.stat === stat) ?? props[0];
  const statDef = NBA_PROP_STAT_BY_KEY.get(prop.stat)!;
  const consensus = propConsensusPoint(prop.quotes);
  const [pointByStat, setPointByStat] = useState<Partial<Record<NbaPropStat, number>>>({});
  const main = consensus ?? prop.quotes[0]?.point ?? prop.projectedPoint ?? 0;
  const point = pointByStat[prop.stat] ?? main;

  const context = useMemo(
    () => ({
      season,
      venue: player.venue,
      opponent: player.opponent?.abbreviation,
      projection,
      injury: player.injury?.level ?? null,
      modelWeight: modelWeights[prop.stat],
    }),
    [season, player.venue, player.opponent?.abbreviation, projection, player.injury?.level, modelWeights, prop.stat]
  );
  const summary = useMemo(() => summarizeProp(prop, logs, statDef, side, context, point), [prop, logs, statDef, side, context, point]);
  // Yes/No milestones (double-double) have one line; everything else reads up and down the ladder.
  const ladder = useMemo(
    () => (statDef.milestone ? [...new Set(prop.quotes.map((q) => q.point))].sort((a, b) => a - b) : altLinePointsNba(main, prop.quotes.map((q) => q.point))),
    [statDef.milestone, main, prop.quotes]
  );
  const altRows = useMemo(
    () => (statDef.milestone ? [] : altLineRows(prop, logs, statDef, side, context, ladder)),
    [statDef, prop, logs, side, context, ladder]
  );
  const books = useMemo(() => booksAtPoint(prop.quotes, point, side), [prop.quotes, point, side]);
  const pairs = useMemo(() => twoSidedAt(prop.quotes, point), [prop.quotes, point]);
  const fair = fairPrice(pairs);
  const bestBook = side === "over" ? summary?.over?.bookKey : summary?.under?.bookKey;

  const leg: ParlayLeg = {
    id: `${player.id}:${prop.stat}`,
    gameId: player.gameId,
    playerName: player.name,
    team: player.team?.abbreviation ?? player.id,
    statShort: statDef.shortLabel,
    side,
    sideLabel: statDef.milestone ? (side === "over" ? "Yes" : "No") : side === "over" ? "Over" : "Under",
    point,
    modelProb: summary?.model ? (side === "over" ? summary.model.probOver : summary.model.probUnder) : null,
    logs: logs.map((l) => ({ date: l.date, opponent: l.opponent, isHome: l.isHome, season: l.season, value: statDef.value(l) })),
  };

  const statsOffered = NBA_PROP_STATS.filter((s) => props.some((p) => p.stat === s.key));
  const chartLogs = useMemo(() => logs.map((l) => ({ ...l, volume: l.minutes })), [logs]);

  return (
    <PlayerSheet
      name={player.name}
      headshot={[player.headshotUrl]}
      teamLogo={player.team?.logoUrl}
      teamAbbr={player.team?.abbreviation}
      badges={<InjuryBadge injury={player.injury} />}
      sub={
        <>
          {player.opponent && (
            <>
              {player.venue === "home" ? "vs" : "@"}
              <Logo sources={[player.opponent.logoUrl]} alt={player.opponent.name} fallbackText={player.opponent.abbreviation} size={14} />
              {player.opponent.abbreviation} ·{" "}
            </>
          )}
          {startLabel}
        </>
      }
      stats={statsOffered.map((s) => ({ key: s.key, label: s.shortLabel }))}
      stat={prop.stat}
      onStat={(k) => setStat(k as NbaPropStat)}
      onClose={onClose}
    >
      <LinePicker
        label={statDef.label}
        value={point}
        side={side}
        onSide={setSide}
        ladder={ladder.map((p) => ({ point: p, main: p === main }))}
        point={point}
        onPoint={(p) => setPointByStat((m) => ({ ...m, [prop.stat]: p }))}
      />

      <ParlayButton leg={leg} legs={parlay} onAdd={onAddLeg} />

      {summary?.projected && (
        <ProjectedNote>
          <span className="font-semibold">No book has posted this yet.</span> {point}{" "}is ARCHR&apos;s line — the projection to the nearest half-point. Books
          usually post NBA props the morning of the game; their line and prices replace this the moment they do.
        </ProjectedNote>
      )}

      <SheetSection title={`${statDef.label} by game`} brand>
        <PropGameChart
          logs={chartLogs}
          value={(l) => statDef.value(l)}
          statShort={statDef.shortLabel}
          point={point}
          side={side}
          season={season}
          projection={summary?.model?.projection.mean ?? null}
          opponent={player.opponent?.abbreviation}
          venue={player.venue}
          volumeLabel="min"
          lineLabel={summary?.projected ? "ARCHR line" : "Line"}
        />
      </SheetSection>

      {player.injury?.level && (
        <p className={`rounded-lg px-3 py-2 text-xs ${player.injury.level === "out" || player.injury.level === "doubtful" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-amber-500/10 text-amber-800 dark:text-amber-200"}`}>
          <span className="font-semibold">{player.injury.status}</span>
          {player.injury.detail ? ` — ${player.injury.detail}` : ""}.{" "}
          {player.injury.level === "out" || player.injury.level === "doubtful"
            ? "No projection while he's listed this way; books usually pull his props."
            : "The projection's confidence is widened until he's cleared."}
        </p>
      )}

      {summary?.model && <ProjectionPanel model={summary.model} point={point} side={side} statShort={statDef.shortLabel} milestone={!!statDef.milestone} />}

      {altRows.length > 1 && (
        <AltLinesTable
          rows={altRows}
          columns={NBA_ALT_COLUMNS.map((c) => c.label)}
          point={point}
          main={main}
          sideLabel={side === "over" ? "Over" : "Under"}
          projection={summary?.model ? summary.model.projection.mean.toFixed(1) : null}
          statShort={statDef.shortLabel}
          onPoint={(p) => setPointByStat((m) => ({ ...m, [prop.stat]: p }))}
        />
      )}

      {summary && (
        <SheetSection title="Hit rates">
          <SplitGrid splits={summary.splits} />
        </SheetSection>
      )}

      {summary && (
        <SheetSection title="Matchup">
          <MatchupPanel
            defense={defense}
            player={player}
            stat={statDef}
            side={side}
            h2h={summary.splits.find((sp) => sp.key === "h2h")}
            minutesL5={summary.avgMinutesL5}
            minutesSeason={summary.avgMinutesSeason}
          />
        </SheetSection>
      )}

      <BooksTable point={point} books={books} pairs={pairs} side={side} bestBook={bestBook} fairProbOver={fair?.probA ?? null} projected={!!summary?.projected} />

      <RecentGames
        rows={logs.map((g) => ({ date: g.date, opponent: g.opponent, isHome: g.isHome, volume: g.minutes, value: statDef.value(g) }))}
        statShort={statDef.shortLabel}
        volumeLabel="Min"
        point={point}
        side={side}
      />

      <SheetFooter />
    </PlayerSheet>
  );
}
