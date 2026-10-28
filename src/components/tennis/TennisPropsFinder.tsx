"use client";

import Link from "next/link";
import { Fragment, useCallback, useMemo, useState } from "react";
import {
  TENNIS_PROP_STATS,
  TENNIS_PROP_STAT_BY_KEY,
  serveReturn,
  tennisLine,
  tennisOver,
  tennisSplits,
  type TennisPropStat,
  type TennisPropStatDef,
} from "@/lib/tennis/propModel";
import { unpackTennisLog, type TennisLog } from "@/lib/tennis/matchLog";
import type { TennisPropsPlayer, TennisPropsSlate } from "@/lib/queries/tennisProps";
import { tallyPropHits, type PropDirection } from "@/lib/props/tally";
import { decimalToAmerican, formatAmerican } from "@/lib/odds/americanOdds";
import { HitMeter, formatRate, rateTone } from "@/components/nba/HitMeter";
import { SplitGrid } from "@/components/nba/Matchup";
import { PropGameChart } from "@/components/props/PropGameChart";
import {
  ArchrLineChip,
  initials,
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

const pct = (p: number | null, d = 0) => (p === null ? "—" : `${(p * 100).toFixed(d)}%`);
const fair = (p: number) => formatAmerican(Math.round(decimalToAmerican(1 / Math.min(0.995, Math.max(0.005, p)))));
const surname = (n: string) => n.split(" ").at(-1)!;
function start(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}

interface Row {
  player: TennisPropsPlayer;
  point: number;
  chance: number;
  mean: number;
  l10: ReturnType<typeof tallyPropHits>;
  recent: boolean[];
}

function rowFor(player: TennisPropsPlayer, stat: TennisPropStatDef, side: PropDirection, logs: TennisLog[], bestOf: number, at?: number): Row | null {
  const proj = player.projections[stat.key];
  if (!proj) return null;
  const point = at ?? tennisLine(proj);
  const over = tennisOver(proj, point);
  const values = logs.filter((l) => stat.value(l) !== null && !l.incomplete && l.bestOf === bestOf).slice(0, 10).map((l) => stat.value(l)!);
  return { player, point, chance: side === "over" ? over : 1 - over, mean: proj.mean, l10: tallyPropHits(values, point, side), recent: values.map((v) => (side === "over" ? v > point : v < point)) };
}

function TennisCard({ row, stat, side, logs, season, match, onOpen }: { row: Row; stat: TennisPropStatDef; side: PropDirection; logs: TennisLog[]; season: number; match?: TennisPropsSlate["matches"][number]; onOpen: () => void }) {
  const { player } = row;
  const splits = tennisSplits(logs, stat, row.point, side, { season, surface: match?.surface ?? null, opponent: player.opponent, bestOf: match?.bestOf });
  const strip = splits.filter((x) => (["l5", "season", "venue"].includes(x.key) || x.key === "h2h") && x.rate.sampleSize > 0);
  return (
    <PropCard
      onOpen={onOpen}
      headshot={[player.photo]}
      name={player.name}
      tag={player.tour.toUpperCase()}
      sub={
        <>
          vs {player.opponent}
          {match && <span className="shrink-0">· {start(match.startsAt)}</span>}
        </>
      }
      value={row.point}
      unit={stat.shortLabel}
      under={
        <>
          proj <span className="font-mono font-semibold text-foreground">{row.mean.toFixed(1)}</span> · win {pct(player.winProb)}
        </>
      }
      meter={<HitMeter recent={row.recent} rate={row.l10} />}
      price={<ArchrLineChip label={`${side === "over" ? "O" : "U"} ${pct(row.chance)}`} price={fair(row.chance)} />}
      strip={strip.map((x) => (
        <span key={x.key}>
          {x.label} <span className={`font-mono font-semibold ${rateTone(x.rate)}`}>{formatRate(x.rate)}</span>
        </span>
      ))}
      stripRight={!player.rated ? <span className="font-semibold text-amber-700 dark:text-amber-300">Thin record</span> : player.elo !== null ? <span>Elo {Math.round(player.elo)}</span> : null}
    />
  );
}

function ServePanel({ logs }: { logs: TennisLog[] }) {
  const charted = logs.filter((l) => l.servePoints && l.firstIn !== null && l.serviceGames);
  const l10 = serveReturn(charted.slice(0, 10));
  const yr = serveReturn(charted.slice(0, 40));
  if (!yr.matches) return null;
  const rows: [string, (s: ReturnType<typeof serveReturn>) => string][] = [
    ["1st serve in", (s) => pct(s.firstServeIn)],
    ["1st serve won", (s) => pct(s.firstServeWon)],
    ["2nd serve won", (s) => pct(s.secondServeWon)],
    ["Hold %", (s) => pct(s.holdPct)],
    ["Break points saved", (s) => pct(s.bpSaved)],
    ["Aces / match", (s) => (s.acesPerMatch === null ? "—" : s.acesPerMatch.toFixed(1))],
    ["Double faults / match", (s) => (s.dfsPerMatch === null ? "—" : s.dfsPerMatch.toFixed(1))],
    ["Breaks / match", (s) => (s.breaksPerMatch === null ? "—" : s.breaksPerMatch.toFixed(1))],
  ];
  return (
    <SheetSection title="Serve & return" brand>
      <div className="rounded-xl border border-border bg-card p-3.5">
        <div className="grid grid-cols-[1fr_4.5rem_4.5rem] gap-y-1.5 text-sm">
          <span />
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">L10 · {l10.matches}</span>
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">L40 · {yr.matches}</span>
          {rows.map(([label, get]) => (
            <Fragment key={label}>
              <span className="text-muted-foreground">{label}</span>
              <span className="text-right font-mono font-semibold text-foreground">{get(l10)}</span>
              <span className="text-right font-mono text-foreground/70">{get(yr)}</span>
            </Fragment>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
          His last matches with a serve line in the ATP/WTA archive{charted[0] ? `, through ${charted[0].date}` : ""}; ESPN&apos;s recent results carry the score only.
        </p>
      </div>
    </SheetSection>
  );
}

function Sheet({ player, match, logs, season, initialStat, side: initialSide, onClose }: { player: TennisPropsPlayer; match?: TennisPropsSlate["matches"][number]; logs: TennisLog[]; season: number; initialStat: TennisPropStat; side: PropDirection; onClose: () => void }) {
  const offered = TENNIS_PROP_STATS.filter((s) => player.projections[s.key]);
  const [statKey, setStatKey] = useState<TennisPropStat>(player.projections[initialStat] ? initialStat : offered[0]!.key);
  const [side, setSide] = useState(initialSide);
  const [pointBy, setPointBy] = useState<Partial<Record<TennisPropStat, number>>>({});
  const stat = TENNIS_PROP_STAT_BY_KEY.get(statKey)!;
  const proj = player.projections[statKey]!;
  const main = tennisLine(proj);
  const point = pointBy[statKey] ?? main;
  const over = tennisOver(proj, point);
  const splits = tennisSplits(logs, stat, point, side, { season, surface: match?.surface ?? null, opponent: player.opponent, bestOf: match?.bestOf });
  const ladder = [-3, -2, -1, 0, 1, 2, 3].map((d) => main + d).filter((p) => p > 0);
  const played = logs.filter((l) => stat.value(l) !== null);
  const h2hRecord = logs.filter((l) => l.opponent === player.opponent);

  return (
    <PlayerSheet
      name={player.name}
      headshot={[player.photo]}
      tag={player.tour.toUpperCase()}
      sub={
        <>
          vs {player.opponent}
          {match && <> · {match.tournament}{match.surface ? ` · ${match.surface}` : ""} · {start(match.startsAt)}</>}
        </>
      }
      stats={offered.map((x) => ({ key: x.key, label: x.shortLabel }))}
      stat={statKey}
      onStat={(k) => setStatKey(k as TennisPropStat)}
      onClose={onClose}
    >
      <LinePicker
        label={stat.label}
        value={point}
        side={side}
        onSide={setSide}
        ladder={ladder.map((p) => {
          const o = tennisOver(proj, p);
          const c = side === "over" ? o : 1 - o;
          return { point: p, main: p === main, sub: `${pct(c)} · ${fair(c)}` };
        })}
        point={point}
        onPoint={(p) => setPointBy((v) => ({ ...v, [statKey]: p }))}
      />

      <ProjectedNote>
        <span className="font-semibold">ARCHR&apos;s price.</span> {`${main} is ARCHR's line`}, where Over and Under are closest to even. Books&apos; prices land here when
        they post this prop.
        {!player.rated && " One of these players has fewer than 10 rated matches, so the win chance leans on a thin record."}
      </ProjectedNote>

      <SheetSection title={`${stat.label} by match`} brand>
        <PropGameChart
          logs={played.map((l) => ({ ...l, opponent: surname(l.opponent), isHome: false, volume: l.minutes ?? undefined }))}
          value={(l) => stat.value(l) ?? 0}
          statShort={stat.shortLabel}
          point={point}
          side={side}
          season={season}
          projection={proj.mean}
          opponent={surname(player.opponent)}
          venue={null}
          volumeLabel="min"
          lineLabel="ARCHR line"
        />
      </SheetSection>

      <ProjectionCard
        headline={proj.mean.toFixed(1)}
        unit={stat.shortLabel}
        swing={proj.sd !== null ? `± ${proj.sd.toFixed(1)} typical swing` : `over ${proj.serviceGames.toFixed(1)} service games`}
        point={point}
        probOver={over}
        ev={null}
        factors={[
          { label: "Win chance", value: pct(player.winProb) },
          { label: "Exp. games", value: proj.expectedGames.toFixed(1) },
          ...(proj.rate !== null
            ? [
                { label: "Per svc game", value: proj.rate.toFixed(2) },
                { label: "Opponent", value: `×${proj.opponentFactor!.toFixed(2)}` },
              ]
            : [
                { label: "Best of", value: String(match?.bestOf ?? 3) },
                { label: "Surface", value: match?.surface ?? "—" },
              ]),
        ]}
        footnote={
          <>
            {stat.key === "aces" || stat.key === "doubleFaults"
              ? "His rate per service game over his last 40 matches, steadied toward the tour's, × what the opponent allows on return, over half the expected games."
              : "Expected games from the Elo win chance (lopsided matches are shorter); his share from the same chance — both fitted on 2019–2026 ATP/WTA."}{" "}
            <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
              How accurate is it?
            </Link>
          </>
        }
      />

      <SheetSection title={`Hit rates · best-of-${match?.bestOf ?? 3} matches`}>
        <SplitGrid splits={splits} />
      </SheetSection>

      <ServePanel logs={logs} />

      <SheetSection title="Matchup">
        <MatchupFacts
          rows={[
            { label: "ARCHR win chance", value: pct(player.winProb), tone: player.winProb > 0.55 ? "good" : player.winProb < 0.45 ? "bad" : "neutral" },
            { label: "Elo", value: player.elo !== null ? String(Math.round(player.elo)) : "Unrated", note: player.surfaceElo !== null ? `${Math.round(player.surfaceElo)} on ${match?.surface}` : `${player.matches} rated matches` },
            { label: `${surname(player.opponent)}'s Elo`, value: player.opponentElo !== null ? String(Math.round(player.opponentElo)) : "Unrated" },
            ...(h2hRecord.length ? [{ label: "Head to head", value: `${h2hRecord.filter((l) => l.won).length}-${h2hRecord.filter((l) => !l.won).length}`, note: `last met ${h2hRecord[0]!.date}` }] : []),
          ]}
        />
      </SheetSection>

      <BooksTable point={point} books={[]} pairs={[]} side={side} bestBook={null} fairProbOver={null} projected />

      <RecentGames
        rows={played.map((l) => ({ date: l.date, opponent: `${surname(l.opponent)} ${l.won ? "W" : "L"}`, isHome: true, volume: `${l.gamesWon}-${l.gamesLost}`, value: stat.value(l)! }))}
        statShort={stat.shortLabel}
        volumeLabel="Games"
        point={point}
        side={side}
        title="Last 10 matches"
      />

      <SheetFooter />
    </PlayerSheet>
  );
}

/** Tennis player props: every singles match in the next day and a half, both players, four stats — the same layout as every sport. */
export function TennisPropsFinder({ slate, initialMatch = null }: { slate: TennisPropsSlate; initialMatch?: string | null }) {
  const [statKey, setStatKey] = useState<TennisPropStat>("gamesWon");
  const [side, setSide] = useState<PropDirection>("over");
  const [sort, setSort] = useState<Sort>("hitRate");
  const [matchId, setMatchId] = useState<string | null>(slate.matches.some((m) => m.id === initialMatch) ? initialMatch : null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const logs = useMemo(() => Object.fromEntries(Object.entries(slate.logs).map(([id, l]) => [id, l.map(unpackTennisLog)])) as Record<string, TennisLog[]>, [slate.logs]);
  const matchById = useMemo(() => new Map(slate.matches.map((m) => [m.id, m])), [slate.matches]);
  const stat = TENNIS_PROP_STAT_BY_KEY.get(statKey)!;
  const counts = useMemo(() => {
    const c = new Map<TennisPropStat, number>();
    for (const p of Object.values(slate.players)) {
      if (matchId && p.matchId !== matchId) continue;
      for (const k of Object.keys(p.projections) as TennisPropStat[]) c.set(k, (c.get(k) ?? 0) + 1);
    }
    return c;
  }, [slate.players, matchId]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const out: Row[] = [];
    for (const p of Object.values(slate.players)) {
      if ((matchId && p.matchId !== matchId) || (needle && !p.name.toLowerCase().includes(needle))) continue;
      const r = rowFor(p, stat, side, logs[p.id] ?? [], matchById.get(p.matchId)?.bestOf ?? 3);
      if (r) out.push(r);
    }
    const key = (r: Row) => (sort === "chance" ? r.chance : sort === "projection" ? (side === "over" ? r.mean : -r.mean) : (r.l10.hitRate ?? -1) + r.chance / 100);
    return out.sort((a, b) => Number(!a.player.rated) - Number(!b.player.rated) || key(b) - key(a));
  }, [slate.players, logs, stat, side, sort, matchId, query, matchById]);
  const openPlayer = open ? slate.players[open] : null;
  const side3 = (n: string, logo: string) => ({ name: n, abbreviation: surname(n), mark: initials(n), logoUrl: logo });

  return (
    <>
      <PropsControls
        stats={TENNIS_PROP_STATS.filter((x) => counts.get(x.key)).map((x) => ({ key: x.key, label: x.shortLabel, count: counts.get(x.key) }))}
        stat={statKey}
        onStat={setStatKey}
        side={side}
        onSide={setSide}
        sorts={SORTS}
        sort={sort}
        onSort={setSort}
        query={query}
        onQuery={setQuery}
      />
      <GameChips allLabel="All matches" separator="v" games={slate.matches.map((m) => ({ id: m.id, away: side3(m.home.name, m.home.logo), home: side3(m.away.name, m.away.logo), start: start(m.startsAt) }))} active={matchId} onSelect={setMatchId} />
      {rows.length > 0 && <ListNote>ARCHR&apos;s line and chance for both players in every match · tap a player for every match, line and split</ListNote>}
      {rows.length === 0 ? (
        <EmptyList title={query ? `No players match “${query}”` : "No tennis props for these matches yet"} hint="Matches show once the draw is set; ratings come from the ATP/WTA archive." />
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {rows.map((r) => (
            <TennisCard key={r.player.id} row={r} stat={stat} side={side} logs={logs[r.player.id] ?? []} season={slate.season} match={matchById.get(r.player.matchId)} onOpen={() => setOpen(r.player.id)} />
          ))}
        </ul>
      )}
      {openPlayer && <Sheet key={openPlayer.id} player={openPlayer} match={matchById.get(openPlayer.matchId)} logs={logs[openPlayer.id] ?? []} season={slate.season} initialStat={statKey} side={side} onClose={close} />}
    </>
  );
}
