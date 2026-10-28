"use client";

import Link from "next/link";
import { Fragment, useCallback, useMemo, useState } from "react";
import type { NflPropStat } from "@/generated/prisma/client";
import { NFL_PROP_STATS, NFL_PROP_STAT_BY_KEY, type NflPropStatDef } from "@/lib/nfl/propStats";
import { sortNflSummaries, summarizeNflProp, unpackNflLog, type NflLogPoint, type NflPropSort, type NflPropSummary, type NflSlateProp, type PackedNflLog } from "@/lib/nfl/propsMath";
import { nflStatMatchup, type NflDefenseTable } from "@/lib/nfl/matchup";
import { matchupGrade, ordinal } from "@/lib/nba/matchup";
import { booksAtPoint, propConsensusPoint, twoSidedAt } from "@/lib/nba/propsMath";
import { fairPrice } from "@/lib/odds/marketValue";
import type { NflPropsSlate, NflSlatePlayer } from "@/lib/queries/nflProps";
import type { SlateGame } from "@/lib/queries/nbaProps";
import type { PropDirection } from "@/lib/props/tally";
import { usageGames, usageWindow, type TeamVolume, type UsageWindow } from "@/lib/nfl/usage";
import { advancedWindow, type AdvancedWindow } from "@/lib/nfl/advanced";
import type { NflTeamContext } from "@/lib/nfl/teamContext";
import { Logo } from "@/components/Logo";
import { EvTag } from "@/components/EvTag";
import { InjuryBadge } from "@/components/InjuryBadge";
import { BlendLine, EnvLine, SeasonMixLine, signed } from "@/components/props/ModelPieces";
import type { NflProjectionContext } from "@/lib/nfl/projection";
import { nflProjectionContext } from "@/lib/nfl/slateContext";
import { HitMeter, formatRate, rateTone } from "@/components/nba/HitMeter";
import { SplitGrid } from "@/components/nba/Matchup";
import { PropGameChart } from "@/components/props/PropGameChart";
import {
  ArchrLineChip,
  BestPriceChip,
  BooksTable,
  EmptyList,
  GameChips,
  LinePicker,
  ListNote,
  MatchupFacts,
  ModelChip,
  PlayerSheet,
  ProjectedDivider,
  ProjectedNote,
  ProjectionCard,
  PropCard,
  PropsControls,
  RecentGames,
  SheetFooter,
  SheetSection,
} from "@/components/props/kit";

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
const sideLabelsOf = (stat: NflPropStatDef): [string, string] => (stat.shape === "anytime" ? ["Yes", "No"] : ["Over", "Under"]);
const short = (stat: NflPropStatDef, side: PropDirection) => (stat.shape === "anytime" ? (side === "over" ? "Yes" : "No") : side === "over" ? "O" : "U");
const digits = (stat: NflPropStatDef) => (stat.shape === "yards" ? 0 : 1);

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

function NflCard({ s, player, game, side, stat, defense, onOpen }: { s: NflPropSummary; player: NflSlatePlayer; game?: SlateGame; side: PropDirection; stat: NflPropStatDef; defense: NflDefenseTable; onOpen: () => void }) {
  const best = side === "over" ? s.over : s.under;
  const other = side === "over" ? s.under : s.over;
  const value = side === "over" ? s.value.over : s.value.under;
  const m = s.model;
  const ev = m ? (side === "over" ? m.evOver : m.evUnder) : null;
  const strip = s.splits.filter((x) => ["l3", "l5", "season"].includes(x.key) || (x.key === "h2h" && x.rate.sampleSize > 0));
  return (
    <PropCard
      onOpen={onOpen}
      headshot={[player.headshotUrl]}
      name={player.name}
      tag={player.position}
      badges={<InjuryBadge injury={player.injury} />}
      teamLogo={player.team?.logoUrl}
      teamAbbr={player.team?.abbreviation}
      sub={
        <>
          {player.opponent && (
            <>
              {player.venue === "home" ? "vs" : "@"}
              <Logo sources={[player.opponent.logoUrl]} alt={player.opponent.name} fallbackText={player.opponent.abbreviation} size={14} />
              {player.opponent.abbreviation}
            </>
          )}
          {game && <span>· {kickoff(game.startUtc)}</span>}
        </>
      }
      value={stat.shape === "anytime" ? (m ? `${Math.round(m.probOver * 100)}%` : "TD") : s.point}
      unit={stat.shape === "anytime" ? "TD" : stat.shortLabel}
      under={
        m ? (
          <>
            proj <span className="font-mono font-semibold text-foreground">{m.projection.mean.toFixed(stat.shape === "anytime" ? 2 : digits(stat))}</span>
            {s.avg !== null && <> · avg {s.avg.toFixed(digits(stat))}</>}
          </>
        ) : s.avg !== null ? (
          <>avg {s.avg.toFixed(digits(stat))} L5</>
        ) : null
      }
      meter={<HitMeter recent={s.recent.slice(0, 5)} rate={s.l5} window="L5" slots={5} />}
      price={
        <>
          {s.projected ? <ArchrLineChip /> : <EvTag value={value} />}
          {s.projected ? null : best ? (
            <BestPriceChip sideLabel={short(stat, side)} price={best.priceAmerican} bookKey={best.bookKey} bookName={best.bookName} />
          ) : (
            <span className="text-xs text-muted-foreground">no {side}</span>
          )}
          {other && !s.projected && (
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              {short(stat, side === "over" ? "under" : "over")} <span className="font-mono">{other.priceAmerican > 0 ? `+${other.priceAmerican}` : other.priceAmerican}</span>
            </span>
          )}
        </>
      }
      strip={strip.map((x) => (
        <span key={x.key}>
          {x.label} <span className={`font-mono font-semibold ${rateTone(x.rate)}`}>{formatRate(x.rate)}</span>
        </span>
      ))}
      stripRight={
        <>
          {!s.projected && m && <ModelChip prob={side === "over" ? m.probOver : m.probUnder} edge={ev !== null && ev >= MODEL_EV_FLAG} />}
          <DefChip defense={defense} player={player} stat={stat} side={side} />
          <span className={s.projected ? "hidden" : "hidden sm:inline"}>
            {s.booksAtLine} book{s.booksAtLine === 1 ? "" : "s"}
            {s.points.length > 1 && ` · ${s.points.length - 1} alt`}
          </span>
        </>
      }
    />
  );
}

const pct = (x: number | null, d = 0) => (x === null ? "—" : `${(x * 100).toFixed(d)}%`);
const num = (x: number | null, d = 1) => (x === null ? "—" : x.toFixed(d));

/** His role and what he does with it: L5 against the season, then his share game by game. */
function UsagePanel({ player, logs, volume, season }: { player: NflSlatePlayer; logs: NflLogPoint[]; volume: TeamVolume[]; season: number }) {
  const seasonIdx = logs.map((l, i) => (l.season === season ? i : -1)).filter((i) => i >= 0);
  const l5 = usageWindow(logs.slice(0, 5), volume.slice(0, 5));
  const szn = usageWindow(seasonIdx.map((i) => logs[i]!), seasonIdx.map((i) => volume[i]!));
  const games = usageGames(logs.slice(0, 10), volume.slice(0, 10)).reverse();
  const pos = player.position;
  type Row = { label: string; get: (w: UsageWindow) => string };
  const rows: Row[] =
    pos === "QB"
      ? [
          { label: "Completion %", get: (w) => pct(w.completionPct, 1) },
          { label: "Yards / attempt", get: (w) => num(w.yardsPerAttempt) },
          { label: "TD rate", get: (w) => pct(w.passTdRate, 1) },
          { label: "INT rate", get: (w) => pct(w.intRate, 1) },
          { label: "Team pass att / g", get: (w) => num(w.teamPassAttempts) },
          { label: "Carries / g", get: (w) => num(w.carriesPerGame) },
        ]
      : pos === "RB"
        ? [
            { label: "Carry share", get: (w) => pct(w.carryShare) },
            { label: "Carries / g", get: (w) => num(w.carriesPerGame) },
            { label: "Yards / carry", get: (w) => num(w.yardsPerCarry) },
            { label: "Target share", get: (w) => pct(w.targetShare) },
            { label: "Catch rate", get: (w) => pct(w.catchRate) },
            { label: "TDs / g", get: (w) => num(w.touchdownsPerGame, 2) },
          ]
        : [
            { label: "Target share", get: (w) => pct(w.targetShare) },
            { label: "Targets / g", get: (w) => num(w.targetsPerGame) },
            { label: "Catch rate", get: (w) => pct(w.catchRate) },
            { label: "Yards / target", get: (w) => num(w.yardsPerTarget) },
            { label: "Yards / catch", get: (w) => num(w.yardsPerReception) },
            { label: "TDs / g", get: (w) => num(w.touchdownsPerGame, 2) },
          ];
  const share = (g: (typeof games)[number]) => (pos === "RB" ? g.carryShare : pos === "QB" ? g.teamPassAttempts / 50 : g.targetShare);
  const shareLabel = pos === "RB" ? "Carry share" : pos === "QB" ? "Team pass attempts" : "Target share";
  const max = Math.max(0.01, ...games.map((g) => share(g) ?? 0));
  if (!logs.length) return null;
  return (
    <SheetSection title="Usage & efficiency" brand>
      <div className="rounded-xl border border-border bg-card p-3.5">
        <div className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-y-1.5 text-sm">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground" />
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">L5</span>
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Season</span>
          {rows.map((r) => (
            <Fragment key={r.label}>
              <span className="text-muted-foreground">{r.label}</span>
              <span className="text-right font-mono font-semibold text-foreground">{r.get(l5)}</span>
              <span className="text-right font-mono text-foreground/70">{r.get(szn)}</span>
            </Fragment>
          ))}
        </div>
        <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{shareLabel} by game</p>
        <div className="mt-1.5 flex h-20 items-end gap-1">
          {games.map((g, i) => {
            const v = share(g);
            return (
              <div key={`${g.date}-${i}`} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                <span className="font-mono text-[9px] text-muted-foreground">{v === null ? "" : pos === "QB" ? g.teamPassAttempts : Math.round(v * 100)}</span>
                <span className={`w-full rounded-t ${i === games.length - 1 ? "bg-brand" : "bg-brand/50"}`} style={{ height: `${((v ?? 0) / max) * 52}px` }} />
                <span className="truncate text-[8px] text-muted-foreground">{g.opponent}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          Share of his team&apos;s {pos === "RB" ? "carries and targets" : pos === "QB" ? "offense through the air" : "targets"} in each game — volume drives props more than anything, and it moves before the box score does.
        </p>
      </div>
    </SheetSection>
  );
}


/** The nflverse line: snaps, how his looks come (depth, red zone, end zone), what they're worth (EPA), and expected TDs vs real ones. */
function AdvancedPanel({ player, logs, season }: { player: NflSlatePlayer; logs: NflLogPoint[]; season: number }) {
  const l5 = advancedWindow(logs.slice(0, 5));
  const szn = advancedWindow(logs.filter((l) => l.season === season));
  if (!szn.games && !l5.games) return null;
  const pos = player.position;
  const sgn = (x: number | null, d = 2) => (x === null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}`);
  type Row = { label: string; get: (w: AdvancedWindow) => string; hint?: string };
  const rows: Row[] =
    pos === "QB"
      ? [
          { label: "Dropbacks / g", get: (w) => num(w.dropbacksPerGame) },
          { label: "EPA / dropback", get: (w) => sgn(w.epaPerDropback) },
          { label: "CPOE", get: (w) => (w.cpoe === null ? "—" : `${w.cpoe >= 0 ? "+" : ""}${w.cpoe.toFixed(1)}`), hint: "completion % over expected" },
          { label: "aDOT", get: (w) => num(w.adot) },
          { label: "Deep throws (20+)", get: (w) => pct(w.deepAttemptRate) },
          { label: "Sack rate", get: (w) => pct(w.sackRate, 1) },
          { label: "Scramble rate", get: (w) => pct(w.scrambleRate, 1) },
          { label: "Red-zone att / g", get: (w) => num(w.rzAttemptsPerGame) },
        ]
      : pos === "RB"
        ? [
            { label: "Snap share", get: (w) => pct(w.snapPct) },
            { label: "Red-zone carries / g", get: (w) => num(w.rzCarriesPerGame) },
            { label: "Goal-line carries / g", get: (w) => num(w.glCarriesPerGame) },
            { label: "EPA / carry", get: (w) => sgn(w.epaPerCarry) },
            { label: "1st downs / carry", get: (w) => pct(w.firstDownsPerCarry) },
            { label: "Target share", get: (w) => pct(w.targetShare) },
            { label: "YAC / catch", get: (w) => num(w.yacPerCatch) },
            { label: "Expected TDs / g", get: (w) => num(w.xTdPerGame, 2), hint: "what his red-zone, goal-line and end-zone looks usually score" },
            { label: "Actual TDs / g", get: (w) => num(w.tdPerGame, 2) },
          ]
        : [
            { label: "Snap share", get: (w) => pct(w.snapPct) },
            { label: "Air-yards share", get: (w) => pct(w.airYardsShare) },
            { label: "aDOT", get: (w) => num(w.adot) },
            { label: "WOPR", get: (w) => num(w.wopr, 2), hint: "1.5 × target share + 0.7 × air-yards share" },
            { label: "Red-zone targets / g", get: (w) => num(w.rzTargetsPerGame) },
            { label: "End-zone targets / g", get: (w) => num(w.ezTargetsPerGame) },
            { label: "Deep targets (20+) / g", get: (w) => num(w.deepTargetsPerGame) },
            { label: "YAC / catch", get: (w) => num(w.yacPerCatch) },
            { label: "EPA / target", get: (w) => sgn(w.epaPerTarget) },
            { label: "1st downs / target", get: (w) => pct(w.firstDownsPerTarget) },
            { label: "Expected TDs / g", get: (w) => num(w.xTdPerGame, 2), hint: "what his red-zone, goal-line and end-zone looks usually score" },
            { label: "Actual TDs / g", get: (w) => num(w.tdPerGame, 2) },
          ];
  const recent = logs.filter((l) => l.snapPct != null).slice(0, 10).reverse();
  return (
    <SheetSection title="Advanced" brand>
      <div className="rounded-xl border border-border bg-card p-3.5">
        <div className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-y-1.5 text-sm">
          <span />
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">L5</span>
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Season · {szn.games}</span>
          {rows.map((r) => (
            <Fragment key={r.label}>
              <span className="text-muted-foreground" title={r.hint}>
                {r.label}
              </span>
              <span className="text-right font-mono font-semibold text-foreground">{r.get(l5)}</span>
              <span className="text-right font-mono text-foreground/70">{r.get(szn)}</span>
            </Fragment>
          ))}
        </div>
        {pos !== "QB" && recent.length > 1 && (
          <>
            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Snap share by game</p>
            <div className="mt-1.5 flex h-20 items-end gap-1">
              {recent.map((l, i) => (
                <div key={`${l.date}-${i}`} className="flex min-w-0 flex-1 flex-col items-center gap-0.5">
                  <span className="font-mono text-[9px] text-muted-foreground">{Math.round((l.snapPct ?? 0) * 100)}</span>
                  <span className={`w-full rounded-t ${i === recent.length - 1 ? "bg-sky-500" : "bg-sky-500/50"}`} style={{ height: `${(l.snapPct ?? 0) * 52}px` }} />
                  <span className="truncate text-[8px] text-muted-foreground">{l.opponent}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          From the nflverse play-by-play and snap counts. Touchdowns follow opportunity: xTD is what his targets and carries inside the 20, at the goal line and into the end zone usually score — the anytime-TD projection leans on it.
        </p>
      </div>
    </SheetSection>
  );
}

const rk = (r: number) => `${ordinal(r)}`;
/** His offense's tendencies and the defense he faces, ranked across the league. */
function TeamPanel({ team, opponent, teams, position }: { team: string | undefined; opponent: string | undefined; teams: Record<string, NflTeamContext>; position: string | null }) {
  const mine = team ? teams[team] : undefined;
  const theirs = opponent ? teams[opponent] : undefined;
  if (!mine && !theirs) return null;
  const sgn = (x: number | null | undefined, d = 2) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}`);
  const rows: { label: string; value: string; note?: string; tone?: "good" | "bad" | "neutral" }[] = [];
  if (mine) {
    const o = mine.offense;
    rows.push(
      { label: `${team} neutral pass rate`, value: pct(o.neutralPassRate), note: `${rk(mine.ranks.neutralPassRate)} · PROE ${sgn(o.proe, 1)} pts (${rk(mine.ranks.proe)})`, tone: position === "RB" ? "neutral" : mine.ranks.proe <= 10 ? "good" : mine.ranks.proe >= 23 ? "bad" : "neutral" },
      { label: `${team} plays / game`, value: num(o.playsPerGame), note: `${rk(mine.ranks.plays)} · ${num(o.rzPlaysPerGame)} red-zone plays / g` },
      { label: `${team} EPA / play`, value: sgn(o.epaPerPlay, 3), note: `pass ${sgn(o.passEpaPerDropback)} (${rk(mine.ranks.passEpa)}) · rush ${sgn(o.rushEpaPerRush)} (${rk(mine.ranks.rushEpa)})` },
    );
  }
  if (theirs) {
    const d = theirs.defense;
    const passSide = position !== "RB";
    const rank = passSide ? theirs.ranks.passEpaAllowed : theirs.ranks.rushEpaAllowed;
    rows.push(
      {
        label: `${opponent} defense vs the ${passSide ? "pass" : "run"}`,
        value: sgn(passSide ? d.passEpaPerDropback : d.rushEpaPerRush),
        note: `EPA allowed per ${passSide ? "dropback" : "rush"} · ${rk(rank)} most`,
        tone: rank <= 10 ? "good" : rank >= 23 ? "bad" : "neutral",
      },
      { label: `${opponent} defense overall`, value: sgn(d.epaPerPlay, 3), note: `EPA allowed per play · ${rk(theirs.ranks.epaAllowed)} most · faces ${num(d.playsPerGame)} plays / g` },
    );
  }
  return (
    <SheetSection title="Offense & defense">
      <MatchupFacts rows={rows} />
      <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">Neutral = 1st and 2nd down, win chance 20–80%, outside the last two minutes of a half. PROE = how much more often they throw there than an average team would. Ranks out of 32, 1st = most.</p>
    </SheetSection>
  );
}

function Sheet({ player, props, logs, volume, season, projection, modelWeights, defense, teams, initialStat, side: initialSide, startLabel, onClose }: { player: NflSlatePlayer; props: NflSlateProp[]; logs: NflLogPoint[]; volume: TeamVolume[]; season: number; projection: NflProjectionContext; modelWeights: Record<string, number>; defense: NflDefenseTable; teams: Record<string, NflTeamContext>; initialStat: NflPropStat; side: PropDirection; startLabel: string; onClose: () => void }) {
  const [statKey, setStatKey] = useState(initialStat);
  const [side, setSide] = useState(initialSide);
  const xtd = useMemo(() => advancedWindow(logs.slice(0, 8)), [logs]);
  const prop = props.find((p) => p.stat === statKey) ?? props[0];
  const stat = NFL_PROP_STAT_BY_KEY.get(prop.stat)!;
  const consensus = propConsensusPoint(prop.quotes);
  const [pointByStat, setPointByStat] = useState<Partial<Record<NflPropStat, number>>>({});
  const point = pointByStat[prop.stat] ?? consensus ?? prop.quotes[0]?.point ?? prop.projectedPoint ?? 0;
  const s = summarizeNflProp(prop, logs, stat, side, { season, venue: player.venue, opponent: player.opponent?.abbreviation ?? null, projection, injury: player.injury?.level ?? null, modelWeight: modelWeights[prop.stat] }, point);
  const books = booksAtPoint(prop.quotes, point, side);
  const pairs = twoSidedAt(prop.quotes, point);
  const fair = fairPrice(pairs);
  const bestBook = side === "over" ? s?.over?.bookKey : s?.under?.bookKey;
  const chartLogs = stat.available ? logs.filter(stat.available) : logs;
  const offered = NFL_PROP_STATS.filter((x) => props.some((p) => p.stat === x.key));
  const m = s?.model;
  const ev = m ? (side === "over" ? m.evOver : m.evUnder) : null;
  const def = player.opponent ? nflStatMatchup(defense, player.opponent.abbreviation, stat, player.position) : null;
  const h2h = s?.splits.find((x) => x.key === "h2h");
  const volLabel = player.position === "QB" ? "Att" : player.position === "RB" ? "Car" : "Tgt";
  const volOf = (l: NflLogPoint) => (player.position === "QB" ? l.passAttempts : player.position === "RB" ? l.rushAttempts : l.targets);

  return (
    <PlayerSheet
      name={player.name}
      headshot={[player.headshotUrl]}
      teamLogo={player.team?.logoUrl}
      teamAbbr={player.team?.abbreviation}
      tag={player.position}
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
      stats={offered.map((x) => ({ key: x.key, label: x.shortLabel }))}
      stat={prop.stat}
      onStat={(k) => setStatKey(k as NflPropStat)}
      onClose={onClose}
    >
      <LinePicker
        label={stat.label}
        value={stat.shape === "anytime" ? "Score a TD" : point}
        side={side}
        onSide={setSide}
        sideLabels={sideLabelsOf(stat)}
        ladder={stat.shape === "anytime" ? [] : (s?.points ?? []).map((p) => ({ point: p, main: p === consensus }))}
        point={point}
        onPoint={(p) => setPointByStat((v) => ({ ...v, [prop.stat]: p }))}
      />

      {s?.projected && (
        <ProjectedNote>
          <span className="font-semibold">No book has posted this yet.</span>{" "}
          {stat.shape === "anytime" ? "This is ARCHR's own read on a touchdown." : <>{point}{" "}is ARCHR&apos;s line — the projection to the nearest half-point.</>} Books post most of
          the week&apos;s props midweek; their line and prices replace this the moment they do.
        </ProjectedNote>
      )}

      <SheetSection title={`${stat.label} by game`} brand>
        <PropGameChart
          logs={chartLogs.map((l) => ({ ...l, volume: volOf(l) }))}
          value={(l) => stat.value(l)}
          statShort={stat.shape === "anytime" ? "TD" : stat.shortLabel}
          point={point}
          side={side}
          season={season}
          projection={m?.projection.mean ?? null}
          opponent={player.opponent?.abbreviation}
          venue={player.venue}
          volumeLabel={volLabel.toLowerCase()}
          lineLabel={s?.projected ? "ARCHR line" : "Line"}
        />
      </SheetSection>

      {player.injury?.level && (
        <p className={`rounded-lg px-3 py-2 text-xs ${player.injury.level === "out" || player.injury.level === "doubtful" ? "bg-red-500/10 text-red-700 dark:text-red-300" : "bg-amber-500/10 text-amber-800 dark:text-amber-200"}`}>
          <span className="font-semibold">{player.injury.status}</span>
          {player.injury.detail ? ` — ${player.injury.detail}` : ""}.{" "}
          {player.injury.level === "out" || player.injury.level === "doubtful" ? "No projection while he's listed this way; books usually pull his props." : "The projection's confidence is widened until he's cleared."}
        </p>
      )}

      {m && (
        <ProjectionCard
          headline={stat.shape === "anytime" ? `${Math.round(m.probOver * 100)}%` : m.projection.mean.toFixed(digits(stat))}
          unit={stat.shape === "anytime" ? "to score" : stat.shortLabel}
          point={point}
          probOver={m.probOver}
          ev={ev}
          sideLabels={stat.shape === "anytime" ? ["Yes", "No"] : ["O", "U"]}
          factors={[
            stat.key === "anytimeTd" && xtd.xTdPerGame !== null
              ? { label: "xTD / g", value: xtd.xTdPerGame.toFixed(2) }
              : { label: "Games", value: String(m.projection.games) },
            { label: "Matchup", value: `×${m.projection.matchupFactor.toFixed(2)}` },
            { label: "Volume", value: `×${m.projection.env.volumeFactor.toFixed(2)}` },
            { label: "Script", value: `×${m.projection.env.scriptFactor.toFixed(2)}` },
          ]}
          footnote={
            <>
              {stat.key === "anytimeTd"
                ? "Each past game counted mostly as the TDs his red-zone, goal-line and end-zone looks usually produce (xTD), steadied by two seasons, × matchup × game environment, then blended with the market. "
                : "Recent per-game production steadied by two seasons, × matchup × game environment, then blended with the market. "}
              <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
                How accurate is it?
              </Link>
            </>
          }
        >
          <BlendLine model={m} side={side} />
          <SeasonMixLine seasons={m.projection.seasons} digits={stat.shape === "yards" ? 0 : stat.shape === "anytime" ? 2 : 1} />
          <EnvLine
            parts={[
              ...(m.projection.env.impliedPoints !== null ? [`implied ${m.projection.env.impliedPoints.toFixed(1)} pts`] : []),
              ...(m.projection.env.spread !== null ? [`spread ${signed(m.projection.env.spread)}`] : []),
            ]}
            effects={[
              { label: "volume", factor: m.projection.env.volumeFactor },
              { label: "script", factor: m.projection.env.scriptFactor },
            ]}
          />
          {m.projection.absence && (
            <p className="mt-3 rounded-lg bg-muted/60 px-2.5 py-2 text-[11px] leading-snug text-muted-foreground">
              <span className="font-semibold text-foreground">Without {m.projection.absence.names.join(" & ")}</span> (out this week): {m.projection.absence.games} games averaging{" "}
              {m.projection.absence.perGame.toFixed(digits(stat))} — blended in.
            </p>
          )}
        </ProjectionCard>
      )}

      {s && (
        <SheetSection title="Hit rates">
          <SplitGrid splits={s.splits} />
        </SheetSection>
      )}

      {player.position && ["QB", "RB", "WR", "TE"].includes(player.position) && <UsagePanel player={player} logs={logs} volume={volume} season={season} />}
      {player.position && ["QB", "RB", "WR", "TE"].includes(player.position) && <AdvancedPanel player={player} logs={logs} season={season} />}

      <SheetSection title="Matchup">
        <MatchupFacts
          rows={[
            ...(def
              ? [
                  {
                    label: `${player.opponent?.abbreviation} vs ${def.position}s`,
                    value: `${ordinal(def.rank)} of ${def.of}`,
                    note: `${def.perGame.toFixed(1)} ${stat.shortLabel.toLowerCase()} allowed per game`,
                    tone: (() => {
                      const g = matchupGrade(def.rank, def.of, side);
                      return g === "great" || g === "good" ? ("good" as const) : g === "neutral" ? ("neutral" as const) : ("bad" as const);
                    })(),
                  },
                ]
              : []),
            ...(h2h && h2h.rate.sampleSize > 0 ? [{ label: `Career vs ${player.opponent?.abbreviation}`, value: formatRate(h2h.rate), note: `${h2h.rate.hits}/${h2h.rate.sampleSize} · avg ${h2h.avg?.toFixed(digits(stat)) ?? "—"}` }] : []),
            ...(m?.projection.env.impliedPoints != null ? [{ label: "Implied team points", value: m.projection.env.impliedPoints.toFixed(1) }] : []),
          ]}
        />
      </SheetSection>

      <TeamPanel team={player.team?.abbreviation} opponent={player.opponent?.abbreviation} teams={teams} position={player.position} />

      <BooksTable point={point} books={books} pairs={pairs} side={side} bestBook={bestBook} fairProbOver={fair?.probA ?? null} projected={!!s?.projected} sideLabels={sideLabelsOf(stat)} />

      <RecentGames
        rows={chartLogs.map((l) => ({ date: l.date, opponent: l.opponent, isHome: l.isHome, volume: volOf(l), value: stat.value(l) }))}
        statShort={stat.shape === "anytime" ? "TD" : stat.shortLabel}
        volumeLabel={volLabel}
        point={point}
        side={side}
      />

      <SheetFooter />
    </PlayerSheet>
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
        projection: nflProjectionContext(slate, player),
        injury: player.injury?.level ?? null,
        modelWeight: slate.modelWeights[prop.stat],
      });
      if (s) out.push(s);
    }
    return sortNflSummaries(out, sort, side);
  }, [slate, logs, statKey, stat, side, sort, gameId, query]);
  const posted = summaries.filter((s) => !s.projected).length;
  const openPlayer = open ? slate.players[open] : null;

  return (
    <>
      <PropsControls
        stats={NFL_PROP_STATS.filter((x) => counts.get(x.key) || x.key === statKey).map((x) => ({ key: x.key, label: x.shortLabel, count: counts.get(x.key) }))}
        stat={statKey}
        onStat={setStatKey}
        side={side}
        onSide={setSide}
        sideLabels={sideLabelsOf(stat)}
        sorts={SORTS}
        sort={sort}
        onSort={setSort}
        query={query}
        onQuery={setQuery}
      />

      {!lockGame && (
        <GameChips games={slate.games.map((g) => ({ id: g.id, away: g.away, home: g.home, start: kickoff(g.startUtc) }))} active={gameId} onSelect={setGameId} />
      )}

      {summaries.length > 0 && (
        <ListNote>
          {posted > 0
            ? `${posted} ${stat.label} ${posted === 1 ? "prop" : "props"} posted · ${side === "over" ? "Over" : "Under"} hit rates at each player's main line · tap a player for every game, line and book`
            : `Books haven't posted ${stat.label.toLowerCase()} props yet — below is ARCHR's line for every player with a role. Tap one for every game against it.`}
        </ListNote>
      )}
      {summaries.length === 0 ? (
        <EmptyList title={query ? `No ${stat.label.toLowerCase()} props match “${query}”` : `No ${stat.label.toLowerCase()} props priced`} hint={`Try another stat${slate.games.length > 1 ? " or game" : ""}.`} />
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {summaries.map((s, i) => (
            <Fragment key={s.playerId}>
              {s.projected && posted > 0 && (i === 0 || !summaries[i - 1]!.projected) && <ProjectedDivider />}
              <NflCard s={s} player={slate.players[s.playerId]} game={gameById.get(slate.players[s.playerId].gameId)} side={side} stat={stat} defense={slate.defense} onOpen={() => setOpen(s.playerId)} />
            </Fragment>
          ))}
        </ul>
      )}

      {openPlayer && (
        <Sheet
          key={openPlayer.id}
          player={openPlayer}
          props={slate.props.filter((p) => p.playerId === openPlayer.id)}
          logs={logs[openPlayer.id] ?? []}
          volume={slate.usage?.[openPlayer.id] ?? []}
          season={slate.season}
          projection={nflProjectionContext(slate, openPlayer)}
          modelWeights={slate.modelWeights}
          defense={slate.defense}
          teams={slate.teams ?? {}}
          initialStat={statKey}
          side={side}
          startLabel={(() => {
            const g = gameById.get(openPlayer.gameId);
            return g ? `${kickoff(g.startUtc)} ET` : "";
          })()}
          onClose={close}
        />
      )}
    </>
  );
}
