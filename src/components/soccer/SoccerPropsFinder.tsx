"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { booksAtPoint, twoSidedAt } from "@/lib/nba/propsMath";
import { fairPrice } from "@/lib/odds/marketValue";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { Logo } from "@/components/Logo";
import { LeagueLogo } from "@/components/allSports/LeagueLogo";
import { HitMeter, formatRate, rateTone } from "@/components/nba/HitMeter";
import { SplitGrid } from "@/components/nba/Matchup";
import { PropGameChart } from "@/components/props/PropGameChart";
import { ScrollRow } from "@/components/ScrollRow";
import {
  ArchrLineChip,
  BooksTable,
  EmptyList,
  GameChips,
  LinePicker,
  ListNote,
  MatchupFacts,
  PlayerSheet,
  ProjectedNote,
  ProjectionCard,
  PropCard,
  PropsControls,
  RecentGames,
  SheetFooter,
  SheetSection,
} from "@/components/props/kit";

type Sort = "hitRate" | "chance" | "projection";
const SORTS: { key: Sort; label: string }[] = [
  { key: "hitRate", label: "Hit rate" },
  { key: "chance", label: "ARCHR chance" },
  { key: "projection", label: "Projection" },
];
const POSITION_LABEL = { G: "GK", D: "DEF", M: "MID", F: "FWD" } as const;

function kickoff(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}
const initials = (n: string) => n.split(" ").map((p) => p[0]).join("").slice(0, 2);
const short = (team: string) => team.replace(/^(AFC|FC|CF|SC|AC|AS|SS|SV|VfB|VfL|RC|RCD|CA|CD|UD|SD)\s+/i, "").split(" ").slice(0, 2).join(" ");
const abbr = (team: string) => short(team).slice(0, 3).toUpperCase();
const sideLabelsOf = (stat: SoccerPropStatDef): [string, string] => (stat.shape === "anytime" ? ["Yes", "No"] : ["Over", "Under"]);
const pct = (p: number) => `${Math.round(p * 100)}%`;
const digits = (stat: SoccerPropStatDef) => (stat.shape === "anytime" ? 2 : 1);
/** ESPN's headshot when it has one, then his Wikipedia photo (the route 404s to initials). */
const photoSources = (p: SoccerPropsPlayer) => [...(p.headshotUrl ? [p.headshotUrl] : []), `/api/soccer/player-photo?id=${encodeURIComponent(p.id)}`];

interface Row {
  player: SoccerPropsPlayer;
  point: number;
  chance: number;
  mean: number;
  l10: ReturnType<typeof tallyPropHits>;
  /** Most recent first (HitMeter lays them out oldest-left). */
  recent: boolean[];
}

function rowFor(player: SoccerPropsPlayer, stat: SoccerPropStatDef, side: PropDirection, logs: SoccerLog[], point?: number): Row | null {
  const proj = player.projections[stat.key];
  if (!proj) return null;
  const at = point ?? soccerLine(stat, proj);
  const over = projectionOver(proj, at, stat);
  const values = logs.filter((l) => l.minutes > 0).slice(0, 10).map(stat.value);
  return {
    player,
    point: at,
    chance: side === "over" ? over : 1 - over,
    mean: projectedMean(proj),
    l10: tallyPropHits(values, at, side),
    recent: values.map((v) => (side === "over" ? v > at : v < at)),
  };
}

function SoccerCard({ row, stat, side, logs, season, startsAt, onOpen }: { row: Row; stat: SoccerPropStatDef; side: PropDirection; logs: SoccerLog[]; season: number; startsAt?: string; onOpen: () => void }) {
  const { player } = row;
  const proj = player.projections[stat.key]!;
  const splits = soccerSplits(logs, stat, row.point, side, { season, venue: player.venue, opponent: player.opponent });
  const strip = splits.filter((x) => ["l5", "season"].includes(x.key) || (x.key === "h2h" && x.rate.sampleSize > 0));
  return (
    <PropCard
      onOpen={onOpen}
      headshot={photoSources(player)}
      name={player.name}
      tag={POSITION_LABEL[player.position]}
      teamLogo={player.teamLogo}
      teamAbbr={abbr(player.team)}
      sub={
        <>
          {player.venue === "home" ? "vs" : "@"}
          <Logo sources={[player.opponentLogo]} alt={player.opponent} fallbackText={initials(player.opponent)} size={14} />
          <span className="truncate">{short(player.opponent)}</span>
          {startsAt && <span className="shrink-0">· {kickoff(startsAt)}</span>}
        </>
      }
      value={stat.shape === "anytime" ? pct(row.chance) : row.point}
      unit={stat.shape === "anytime" ? (side === "over" ? stat.shortLabel : `NO ${stat.shortLabel}`) : stat.shortLabel}
      under={
        <>
          proj <span className="font-mono font-semibold text-foreground">{row.mean.toFixed(digits(stat))}</span> · {Math.round(proj.minutes)}′
        </>
      }
      meter={<HitMeter recent={row.recent} rate={row.l10} />}
      price={<ArchrLineChip label={stat.shape === "anytime" ? (side === "over" ? "Yes" : "No") : `${side === "over" ? "O" : "U"} ${pct(row.chance)}`} price={formatAmerican(fairAmerican(row.chance))} />}
      strip={strip.map((x) => (
        <span key={x.key}>
          {x.label} <span className={`font-mono font-semibold ${rateTone(x.rate)}`}>{formatRate(x.rate)}</span>
        </span>
      ))}
      stripRight={
        player.lineup ? (
          <span className={`font-semibold ${player.lineup === "starting" ? "text-emerald-600 dark:text-brand" : "text-amber-700 dark:text-amber-300"}`}>
            {player.lineup === "starting" ? "✓ Starting XI" : "Bench"}
          </span>
        ) : (
          <span>{pct(proj.playProb)} to play</span>
        )
      }
    />
  );
}

function Sheet({ player, initialStat, side: initialSide, season, cardLogs, startLabel, onClose }: { player: SoccerPropsPlayer; initialStat: SoccerPropStat; side: PropDirection; season: number; cardLogs: SoccerLog[]; startLabel: string; onClose: () => void }) {
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
  const splits = soccerSplits(logs, stat, point, side, { season, venue: player.venue, opponent: player.opponent });
  const quotes = player.books?.[statKey] ?? [];
  const bookPoints = quotes.map((q) => q.point);
  const ladder = stat.shape === "anytime" ? [] : [...new Set([...[0.5, 1.5, 2.5, 3.5, 4.5, 5.5].filter((p) => p <= Math.max(2.5, main + 2)), ...bookPoints])].sort((a, b) => a - b);
  const books = booksAtPoint(quotes, point, side);
  const pairs = twoSidedAt(quotes, point);
  const fair = fairPrice(pairs);
  const bestBook = books.find((b) => b.bettable && b[side] !== null)?.bookKey ?? null;
  const h2h = splits.find((x) => x.key === "h2h");

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

  const played = logs.filter((l) => l.minutes > 0);

  return (
    <PlayerSheet
      name={player.name}
      headshot={photoSources(player)}
      teamLogo={player.teamLogo}
      teamAbbr={abbr(player.team)}
      tag={POSITION_LABEL[player.position]}
      sub={
        <>
          {player.venue === "home" ? "vs" : "@"}
          <Logo sources={[player.opponentLogo]} alt={player.opponent} fallbackText={initials(player.opponent)} size={14} />
          <span className="truncate">{player.opponent}</span> · {startLabel}
        </>
      }
      stats={offered.map((x) => ({ key: x.key, label: x.shortLabel }))}
      stat={statKey}
      onStat={(k) => setStatKey(k as SoccerPropStat)}
      onClose={onClose}
    >
      <LinePicker
        label={stat.label}
        value={stat.shape === "anytime" ? stat.label.replace(/^Anytime /, "").replace(/^To be /, "") : point}
        side={side}
        onSide={setSide}
        sideLabels={sideLabelsOf(stat)}
        ladder={ladder.map((p) => {
          const o = projectionOver(proj, p, stat);
          const c = side === "over" ? o : 1 - o;
          return { point: p, main: p === main, sub: `${pct(c)} · ${formatAmerican(fairAmerican(c))}` };
        })}
        point={point}
        onPoint={(p) => setPointByStat((v) => ({ ...v, [statKey]: p }))}
      />

      <ProjectedNote>
        <span className="font-semibold">ARCHR&apos;s price.</span> {stat.shape === "anytime" ? "" : <>{main} is ARCHR&apos;s line, where Over and Under are closest to even. </>}
        Books&apos; prices land here when they post this prop, with the edge against ARCHR&apos;s.
      </ProjectedNote>

      <SheetSection title={`${stat.label} by match`} brand>
        <PropGameChart
          logs={played.map((l) => ({ ...l, volume: l.minutes }))}
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
      </SheetSection>

      <ProjectionCard
        headline={pct(side === "over" ? over : 1 - over)}
        unit={stat.shape === "anytime" ? (side === "over" ? "yes" : "no") : `${side} ${point}`}
        swing={`fair ${formatAmerican(fairAmerican(side === "over" ? over : 1 - over))} · avg tonight ${projectedMean(proj).toFixed(digits(stat))}`}
        point={point}
        probOver={over}
        ev={null}
        sideLabels={stat.shape === "anytime" ? ["Yes", "No"] : ["O", "U"]}
        factors={[
          { label: "Plays", value: pct(proj.playProb) },
          { label: "Minutes", value: `${Math.round(proj.minutes)}′` },
          { label: "Per 90", value: proj.rate90.toFixed(2) },
          { label: "Matchup", value: `×${proj.factor.toFixed(2)}` },
        ]}
        footnote={
          <>
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
          </>
        }
      />

      <SheetSection title="Hit rates">
        <SplitGrid splits={splits} />
      </SheetSection>

      <SheetSection title="Matchup">
        <MatchupFacts
          rows={[
            { label: "Lineup", value: player.lineup === "starting" ? "Starting XI" : player.lineup === "bench" ? "Bench" : "Not out yet", tone: player.lineup === "starting" ? "good" : player.lineup === "bench" ? "bad" : "neutral" },
            {
              label: stat.matchup === "keeper" ? `${short(player.opponent)} shots on target` : stat.matchup === "attack" ? `${short(player.opponent)} shots allowed` : "Matchup",
              value: `×${proj.factor.toFixed(2)}`,
              note: stat.matchup === "none" ? "fouls and cards follow the player" : "vs the league average, home/away included",
              tone: proj.factor > 1.02 ? "good" : proj.factor < 0.98 ? "bad" : "neutral",
            },
            ...(h2h && h2h.rate.sampleSize > 0 ? [{ label: `vs ${short(player.opponent)}`, value: formatRate(h2h.rate), note: `${h2h.rate.hits}/${h2h.rate.sampleSize}` }] : []),
          ]}
        />
      </SheetSection>

      <BooksTable point={point} books={books} pairs={pairs} side={side} bestBook={bestBook} fairProbOver={fair?.probA ?? null} projected={quotes.length === 0} sideLabels={sideLabelsOf(stat)} />

      <RecentGames
        rows={played.map((l) => ({ date: l.date, opponent: abbr(l.opponent), isHome: l.isHome, volume: `${l.minutes}′`, value: stat.value(l) }))}
        statShort={stat.shortLabel}
        volumeLabel="Min"
        point={point}
        side={side}
        title="Last 10 matches"
      />

      <SheetFooter />
    </PlayerSheet>
  );
}

/**
 * Soccer player props for one league: every stat, every player with a role in
 * the next matches, ARCHR's line and chance on each — the same layout as every
 * sport's props (components/props/kit).
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
  const team = (name: string, logo: string) => ({ name, abbreviation: short(name), logoUrl: logo });

  return (
    <>
      {slate.leagues.length > 1 && (
        <ScrollRow aria-label="Leagues" className="-mx-4 mt-4 px-4">
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
        </ScrollRow>
      )}

      <PropsControls
        stats={SOCCER_PROP_STATS.filter((x) => counts.get(x.key)).map((x) => ({ key: x.key, label: x.shortLabel, count: counts.get(x.key) }))}
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
        placeholder="Player or team"
      />

      <GameChips
        allLabel="All matches"
        separator="v"
        games={slate.matches.map((m) => ({
          id: m.id,
          away: team(m.home.name, m.home.logo),
          home: team(m.away.name, m.away.logo),
          start: kickoff(m.startsAt),
          tag: m.lineups ? <span className="rounded bg-emerald-500/20 px-1 text-[9px] font-bold text-emerald-700 dark:text-emerald-300">XI</span> : undefined,
        }))}
        active={matchId}
        onSelect={setMatchId}
      />

      {rows.length > 0 && (
        <ListNote>ARCHR&apos;s {stat.shape === "anytime" ? "chance and fair price" : "line and chance"} for every player with a role · tap a player for every match, line and split</ListNote>
      )}
      {rows.length === 0 ? (
        <EmptyList title={query ? `No ${stat.label.toLowerCase()} props match “${query}”` : `No ${stat.label.toLowerCase()} props for these matches yet`} hint="Try another stat or match." />
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {rows.map((r) => (
            <SoccerCard key={r.player.id} row={r} stat={stat} side={side} logs={logs[r.player.id] ?? []} season={slate.season} startsAt={matchById.get(r.player.matchId)?.startsAt} onOpen={() => setOpen(r.player.id)} />
          ))}
        </ul>
      )}

      {openPlayer && (
        <Sheet
          key={openPlayer.id}
          player={openPlayer}
          initialStat={statKey}
          side={side}
          season={slate.season}
          cardLogs={logs[openPlayer.id] ?? []}
          startLabel={(() => {
            const m = matchById.get(openPlayer.matchId);
            return m ? `${kickoff(m.startsAt)} ET` : "";
          })()}
          onClose={close}
        />
      )}
    </>
  );
}
