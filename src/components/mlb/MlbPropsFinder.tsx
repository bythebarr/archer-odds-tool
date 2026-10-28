"use client";

import Link from "next/link";
import { Fragment, useCallback, useMemo, useState } from "react";
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
import { fairPrice, valueOf, type PriceValue } from "@/lib/odds/marketValue";
import { decimalToAmerican, formatAmerican } from "@/lib/odds/americanOdds";
import { isBettableBook } from "@/lib/odds/bestPrice";
import { tallyPropHits, type PropDirection } from "@/lib/props/tally";
import type { PricedProp } from "@/lib/propModel/price";
import { Logo } from "@/components/Logo";
import { EvTag } from "@/components/EvTag";
import { HitMeter, formatRate, rateTone } from "@/components/nba/HitMeter";
import { SplitGrid } from "@/components/nba/Matchup";
import { BlendLine } from "@/components/props/ModelPieces";
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

type Sort = "hitRate" | "value" | "model" | "chance" | "price";
const SORTS: { key: Sort; label: string }[] = [
  { key: "hitRate", label: "Hit rate" },
  { key: "chance", label: "ARCHR chance" },
  { key: "model", label: "Model edge" },
  { key: "value", label: "Market value" },
  { key: "price", label: "Best price" },
];
const MODEL_EV_FLAG = 0.03;

const pct = (p: number) => `${Math.round(p * 100)}%`;
const fair = (p: number) => formatAmerican(Math.round(decimalToAmerican(1 / Math.min(0.995, Math.max(0.005, p)))));
function firstPitch(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}

interface Row {
  prop: MlbSlateProp;
  player: MlbPropsPlayer;
  point: number;
  points: number[];
  consensus: number | null;
  projected: boolean;
  priced: PricedProp;
  over: { priceAmerican: number; bookKey: string; bookName: string } | null;
  under: { priceAmerican: number; bookKey: string; bookName: string } | null;
  value: { over: PriceValue | null; under: PriceValue | null };
  booksAtLine: number;
  l10: ReturnType<typeof tallyPropHits>;
  /** Most recent first (HitMeter lays them out oldest-left). */
  recent: boolean[];
  avgL10: number | null;
}

function rowFor(prop: MlbSlateProp, stat: MlbPropStatDef, side: PropDirection, player: MlbPropsPlayer, logs: MlbChartLog[], at?: number): Row {
  const consensus = propConsensusPoint(prop.quotes);
  const point = at ?? consensus ?? prop.quotes[0]?.point ?? mlbProjectedLine(prop.projection.distribution, prop.projection.mean);
  const priced = priceMlbLine(prop.projection.distribution, prop.quotes, point, prop.stat);
  const best = (s: PropDirection) =>
    prop.quotes.filter((q) => q.point === point && q.side === s && isBettableBook(q.bookKey)).reduce<(typeof prop.quotes)[number] | null>((b, q) => (!b || q.priceAmerican > b.priceAmerican ? q : b), null);
  const over = best("over");
  const under = best("under");
  const pairs = twoSidedAt(prop.quotes, point);
  const values = roleLogs(logs, stat.role).slice(0, 10).map(stat.value);
  return {
    prop,
    player,
    point,
    points: [...new Set(prop.quotes.map((q) => q.point))].sort((a, b) => a - b),
    consensus,
    projected: prop.quotes.length === 0,
    priced,
    over,
    under,
    value: { over: over ? valueOf(pairs, "A", over.priceAmerican, over.bookKey) : null, under: under ? valueOf(pairs, "B", under.priceAmerican, under.bookKey) : null },
    booksAtLine: new Set(prop.quotes.filter((q) => q.point === point && isBettableBook(q.bookKey)).map((q) => q.bookKey)).size,
    l10: tallyPropHits(values, point, side),
    recent: values.map((v) => (side === "over" ? v > point : v < point)),
    avgL10: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
  };
}

function MlbCard({ row, stat, side, logs, season, startUtc, onOpen }: { row: Row; stat: MlbPropStatDef; side: PropDirection; logs: MlbChartLog[]; season: number; startUtc?: string; onOpen: () => void }) {
  const { player, priced } = row;
  const chance = side === "over" ? priced.probOver : priced.probUnder;
  const ev = side === "over" ? priced.evOver : priced.evUnder;
  const best = side === "over" ? row.over : row.under;
  const other = side === "over" ? row.under : row.over;
  const splits = mlbSplits(logs, stat, row.point, side, { season, venue: player.venue, opponent: player.opponent.abbreviation, hand: player.opposingHand });
  const strip = splits.filter((x) => ["l5", "season", "hand"].includes(x.key) || (x.key === "h2h" && x.rate.sampleSize > 0));
  return (
    <PropCard
      onOpen={onOpen}
      headshot={[player.headshotUrl]}
      name={player.name}
      tag={player.role === "pitcher" ? "SP" : player.battingOrder ? `#${player.battingOrder}` : undefined}
      teamLogo={player.team.logoUrl}
      teamAbbr={player.team.abbreviation}
      sub={
        <>
          {player.venue === "home" ? "vs" : "@"}
          <Logo sources={player.opponent.logoUrl ? [player.opponent.logoUrl] : []} alt={player.opponent.name} fallbackText={player.opponent.abbreviation} size={14} />
          {player.opponent.abbreviation}
          {player.role === "batter" && player.opposingStarter && <span className="truncate">· vs {player.opposingStarter.split(" ").at(-1)} ({player.opposingHand ?? "?"})</span>}
          {startUtc && <span className="shrink-0">· {firstPitch(startUtc)}</span>}
        </>
      }
      value={row.point}
      unit={stat.shortLabel}
      under={
        <>
          proj <span className="font-mono font-semibold text-foreground">{row.prop.projection.mean.toFixed(stat.key === "outsRecorded" ? 1 : 2)}</span>
          {row.avgL10 !== null && <> · avg {row.avgL10.toFixed(1)}</>}
        </>
      }
      meter={<HitMeter recent={row.recent} rate={row.l10} />}
      price={
        <>
          {row.projected ? <ArchrLineChip label={`${side === "over" ? "O" : "U"} ${pct(chance)}`} price={fair(chance)} /> : <EvTag value={side === "over" ? row.value.over : row.value.under} />}
          {row.projected ? null : best ? (
            <BestPriceChip sideLabel={side === "over" ? "O" : "U"} price={best.priceAmerican} bookKey={best.bookKey} bookName={best.bookName} />
          ) : (
            <span className="text-xs text-muted-foreground">no {side}</span>
          )}
          {other && !row.projected && (
            <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
              {side === "over" ? "U" : "O"} <span className="font-mono">{formatAmerican(other.priceAmerican)}</span>
            </span>
          )}
        </>
      }
      strip={strip.map((x) => (
        <span key={`${x.key}${x.label}`}>
          {x.label} <span className={`font-mono font-semibold ${rateTone(x.rate)}`}>{formatRate(x.rate)}</span>
        </span>
      ))}
      stripRight={
        <>
          {!row.projected && <ModelChip prob={chance} edge={ev !== null && ev >= MODEL_EV_FLAG} />}
          <span className={row.projected ? "hidden" : "hidden sm:inline"}>
            {row.booksAtLine} book{row.booksAtLine === 1 ? "" : "s"}
            {row.points.length > 1 && ` · ${row.points.length - 1} alt`}
          </span>
        </>
      }
    />
  );
}

function Sheet({ player, props, logs, season, initialStat, side: initialSide, startLabel, onClose }: { player: MlbPropsPlayer; props: MlbSlateProp[]; logs: MlbChartLog[]; season: number; initialStat: MlbPropStat; side: PropDirection; startLabel: string; onClose: () => void }) {
  const offered = MLB_PROP_STATS.filter((s) => props.some((p) => p.stat === s.key));
  const [statKey, setStatKey] = useState<MlbPropStat>(props.some((p) => p.stat === initialStat) ? initialStat : offered[0]!.key);
  const [side, setSide] = useState(initialSide);
  const [pointBy, setPointBy] = useState<Partial<Record<MlbPropStat, number>>>({});
  const stat = MLB_PROP_STAT_BY_KEY.get(statKey)!;
  const prop = props.find((p) => p.stat === statKey)!;
  const proj = prop.projection;
  const main = propConsensusPoint(prop.quotes) ?? prop.quotes[0]?.point ?? mlbProjectedLine(proj.distribution, proj.mean);
  const point = pointBy[statKey] ?? main;
  const row = rowFor(prop, stat, side, player, logs, point);
  const priced = row.priced;
  const ev = side === "over" ? priced.evOver : priced.evUnder;
  const books = booksAtPoint(prop.quotes, point, side);
  const pairs = twoSidedAt(prop.quotes, point);
  const market = fairPrice(pairs);
  const ladderPoints = [...new Set([...row.points, ...[0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 14.5, 15.5, 16.5, 17.5, 18.5].filter((p) => Math.abs(p - main) <= 2.5)])].sort((a, b) => a - b);
  const splits = mlbSplits(logs, stat, point, side, { season, venue: player.venue, opponent: player.opponent.abbreviation, hand: player.opposingHand });
  const games = roleLogs(logs, stat.role);
  const vol = (l: MlbChartLog) => (stat.role === "batter" ? l.plateAppearances : l.outsRecorded);
  const handSplit = splits.find((x) => x.key === "hand");
  const h2h = splits.find((x) => x.key === "h2h");

  return (
    <PlayerSheet
      name={player.name}
      headshot={[player.headshotUrl]}
      teamLogo={player.team.logoUrl}
      teamAbbr={player.team.abbreviation}
      tag={player.role === "pitcher" ? "SP" : player.battingOrder ? `Batting ${player.battingOrder}` : undefined}
      sub={
        <>
          {player.venue === "home" ? "vs" : "@"}
          <Logo sources={player.opponent.logoUrl ? [player.opponent.logoUrl] : []} alt={player.opponent.name} fallbackText={player.opponent.abbreviation} size={14} />
          {player.opponent.abbreviation} · {startLabel}
        </>
      }
      stats={offered.map((x) => ({ key: x.key, label: x.shortLabel }))}
      stat={statKey}
      onStat={(k) => setStatKey(k as MlbPropStat)}
      onClose={onClose}
    >
      <LinePicker
        label={stat.label}
        value={point}
        side={side}
        onSide={setSide}
        ladder={ladderPoints.map((p) => {
          const pr = priceMlbLine(proj.distribution, prop.quotes, p, statKey);
          const c = side === "over" ? pr.probOver : pr.probUnder;
          return { point: p, main: p === main, sub: `${pct(c)} · ${fair(c)}` };
        })}
        point={point}
        onPoint={(p) => setPointBy((v) => ({ ...v, [statKey]: p }))}
      />

      {row.projected && (
        <ProjectedNote>
          <span className="font-semibold">No book has posted this yet.</span> {main} is ARCHR&apos;s line, where Over and Under are closest to even. Books&apos; lines and
          prices replace it the moment they post.
        </ProjectedNote>
      )}

      <SheetSection title={`${stat.label} by game`} brand>
        <PropGameChart
          logs={games.map((l) => ({ ...l, volume: vol(l) ?? undefined }))}
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
      </SheetSection>

      <ProjectionCard
        headline={proj.mean.toFixed(stat.key === "outsRecorded" ? 1 : 2)}
        unit={stat.shortLabel}
        swing={`over ${proj.volume.toFixed(1)} ${stat.role === "batter" ? "plate appearances" : "batters faced"}`}
        point={point}
        probOver={priced.probOver}
        ev={ev}
        factors={[
          { label: stat.role === "batter" ? "Exp. PA" : "Exp. BF", value: proj.volume.toFixed(1) },
          { label: stat.role === "batter" ? "Per PA" : "Per BF", value: proj.rate !== null ? proj.rate.toFixed(3) : "—" },
          { label: stat.role === "batter" ? "Platoon" : "Opp K%", value: `×${(stat.role === "batter" ? proj.platoonFactor : proj.matchupFactor).toFixed(2)}` },
          { label: "Games", value: String(proj.games) },
        ]}
        footnote={
          <>
            {stat.role === "batter"
              ? "His per-plate-appearance rate over two seasons (recent games weighted up), steadied toward the league, × his split against tonight's starter's hand and the starter's strikeout rate, over a spread of plate appearances."
              : "His per-batter rates over his recent starts, steadied toward the league, × the opposing lineup's strikeout rate, over a spread of batters faced."}{" "}
            <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
              How accurate is it?
            </Link>
          </>
        }
      >
        <BlendLine model={priced} side={side} />
      </ProjectionCard>

      <SheetSection title="Hit rates">
        <SplitGrid splits={splits} />
      </SheetSection>

      <SheetSection title="Matchup">
        <MatchupFacts
          rows={[
            ...(player.role === "batter"
              ? [
                  { label: "Opposing starter", value: player.opposingStarter ? `${player.opposingStarter.split(" ").at(-1)} (${player.opposingHand ?? "?"}HP)` : "TBD" },
                  ...(handSplit && handSplit.rate.sampleSize > 0 ? [{ label: `His ${stat.shortLabel} ${handSplit.label}`, value: formatRate(handSplit.rate), note: `${handSplit.rate.hits}/${handSplit.rate.sampleSize} · avg ${handSplit.avg?.toFixed(2) ?? "—"}` }] : []),
                  { label: "Platoon adjustment", value: `×${proj.platoonFactor.toFixed(2)}`, tone: proj.platoonFactor > 1.01 ? ("good" as const) : proj.platoonFactor < 0.99 ? ("bad" as const) : ("neutral" as const) },
                  ...(proj.matchupFactor !== 1 ? [{ label: "Starter's strikeout rate", value: `×${proj.matchupFactor.toFixed(2)}`, note: "on his strikeout chance" }] : []),
                ]
              : [{ label: "Opposing lineup K rate", value: `×${proj.matchupFactor.toFixed(2)}`, note: "vs the league, last 30 days", tone: proj.matchupFactor > 1.01 ? ("good" as const) : proj.matchupFactor < 0.99 ? ("bad" as const) : ("neutral" as const) }]),
            ...(h2h && h2h.rate.sampleSize > 0 ? [{ label: `Career vs ${player.opponent.abbreviation}`, value: formatRate(h2h.rate), note: `${h2h.rate.hits}/${h2h.rate.sampleSize}` }] : []),
          ]}
        />
      </SheetSection>

      <BooksTable point={point} books={books} pairs={pairs} side={side} bestBook={(side === "over" ? row.over : row.under)?.bookKey} fairProbOver={market?.probA ?? null} projected={row.projected} />

      <RecentGames
        rows={games.map((l) => ({ date: l.date, opponent: l.opponent, isHome: l.isHome, volume: vol(l), value: stat.value(l) }))}
        statShort={stat.shortLabel}
        volumeLabel={stat.role === "batter" ? "PA" : "Outs"}
        point={point}
        side={side}
      />

      <SheetFooter />
    </PlayerSheet>
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
  const [sort, setSort] = useState<Sort>("hitRate");
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
      out.push(rowFor(prop, stat, side, player, logs[prop.playerId] ?? []));
    }
    const key: Record<Sort, (r: Row) => number> = {
      hitRate: (r) => (r.l10.hitRate ?? -1) + Math.min(r.l10.sampleSize, 10) / 1000,
      chance: (r) => (side === "over" ? r.priced.probOver : r.priced.probUnder),
      model: (r) => (side === "over" ? r.priced.evOver : r.priced.evUnder) ?? -Infinity,
      value: (r) => (side === "over" ? r.value.over : r.value.under)?.ev ?? -Infinity,
      price: (r) => {
        const b = side === "over" ? r.over : r.under;
        return b ? (b.priceAmerican > 0 ? b.priceAmerican / 100 + 1 : 100 / -b.priceAmerican + 1) : -Infinity;
      },
    };
    return out.sort((a, b) => Number(a.projected) - Number(b.projected) || key[sort](b) - key[sort](a));
  }, [slate, logs, statKey, stat, side, sort, gameId, query]);
  const posted = rows.filter((r) => !r.projected).length;
  const openPlayer = open ? slate.players[open] : null;

  return (
    <>
      <PropsControls
        stats={MLB_PROP_STATS.filter((x) => counts.get(x.key)).map((x) => ({ key: x.key, label: x.shortLabel, count: counts.get(x.key) }))}
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

      <GameChips games={slate.games.map((g) => ({ id: g.id, away: g.away, home: g.home, start: firstPitch(g.startUtc) }))} active={gameId} onSelect={setGameId} />

      {rows.length > 0 && (
        <ListNote>
          {posted > 0
            ? `${posted} ${stat.label.toLowerCase()} props posted · ${side === "over" ? "Over" : "Under"} hit rates at each player's main line · tap a player for every game, line and book`
            : `Books haven't posted ${stat.label.toLowerCase()} yet — below is ARCHR's line for every ${stat.role === "pitcher" ? "starter" : "batter"}. Tap one for every game against it.`}
        </ListNote>
      )}
      {rows.length === 0 ? (
        <EmptyList title={query ? `No ${stat.label.toLowerCase()} props match “${query}”` : `No ${stat.label.toLowerCase()} props priced`} hint={`Try another stat${slate.games.length > 1 ? " or game" : ""}.`} />
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {rows.map((r, i) => (
            <Fragment key={r.player.id}>
              {r.projected && posted > 0 && (i === 0 || !rows[i - 1]!.projected) && <ProjectedDivider />}
              <MlbCard row={r} stat={stat} side={side} logs={logs[r.player.id] ?? []} season={slate.season} startUtc={gameById.get(r.player.gameId)?.startUtc} onOpen={() => setOpen(r.player.id)} />
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
          season={slate.season}
          initialStat={statKey}
          side={side}
          startLabel={(() => {
            const g = gameById.get(openPlayer.gameId);
            return g ? `${firstPitch(g.startUtc)} ET` : "";
          })()}
          onClose={close}
        />
      )}
    </>
  );
}
