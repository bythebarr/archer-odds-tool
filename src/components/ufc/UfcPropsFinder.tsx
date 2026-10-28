"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { UFC_PROP_STATS, UFC_PROP_STAT_BY_KEY, ufcCareerNumbers, ufcPropLine, ufcPropOver, type UfcFightLog, type UfcPropStat, type UfcPropStatDef } from "@/lib/ufc/propModel";
import type { UfcPropsBout, UfcPropsFighter, UfcPropsSlate } from "@/lib/queries/ufcProps";
import type { PropSplit } from "@/lib/nba/propsMath";
import { tallyPropHits, type PropDirection } from "@/lib/props/tally";
import { decimalToAmerican, formatAmerican } from "@/lib/odds/americanOdds";
import { HitMeter, formatRate, rateTone } from "@/components/nba/HitMeter";
import { SplitGrid } from "@/components/nba/Matchup";
import { PropGameChart } from "@/components/props/PropGameChart";
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
  Segmented,
  SheetFooter,
  SheetSection,
  initials,
  sideOptions,
} from "@/components/props/kit";

type Sort = "chance" | "projection" | "hitRate";
const SORTS: { key: Sort; label: string }[] = [
  { key: "projection", label: "Projection" },
  { key: "hitRate", label: "Hit rate" },
  { key: "chance", label: "ARCHR chance" },
];

const pct = (p: number | null, d = 0) => (p === null ? "—" : `${(p * 100).toFixed(d)}%`);
const num = (x: number | null, d = 1) => (x === null ? "—" : x.toFixed(d));
const fair = (p: number) => formatAmerican(Math.round(decimalToAmerican(1 / Math.min(0.995, Math.max(0.005, p)))));
const surname = (n: string) => n.split(" ").at(-1)!;
const day = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(iso));
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const methodShort = (m: string | null) => (!m ? "" : /ko|tko/i.test(m) ? "KO" : /sub/i.test(m) ? "SUB" : /dec/i.test(m) ? "DEC" : /dq/i.test(m) ? "DQ" : "NC");

/** The fight's date (or, without one, his last fight's): what "last 2 years" counts back from. */
const asOf = (bout: UfcPropsBout | undefined, logs: UfcFightLog[]) => new Date(bout?.eventDate ?? logs[0]?.date ?? "2026-01-01");

/** A fight's stat, when the fight has a stat line. */
const played = (logs: UfcFightLog[]) => logs.filter((l) => l.mine && l.seconds > 0);

export function ufcSplits(logs: UfcFightLog[], stat: UfcPropStatDef, point: number, side: PropDirection, ctx: { rounds: number; opponentId: string; asOf: Date }): PropSplit[] {
  const list = played(logs);
  const make = (key: PropSplit["key"], label: string, l: UfcFightLog[]): PropSplit => {
    const values = l.map((x) => stat.value(x.mine!));
    return { key, label, rate: tallyPropHits(values, point, side), avg: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
  };
  const twoYears = ctx.asOf.getTime() - 2 * 365 * 86_400_000;
  return [
    make("l3", "L3", list.slice(0, 3)),
    make("l5", "L5", list.slice(0, 5)),
    make("l10", "L10", list.slice(0, 10)),
    make("season", "Last 2 yrs", list.filter((l) => new Date(l.date).getTime() > twoYears)),
    make("lastSeason", "UFC career", list),
    make("venue", `${ctx.rounds}-rd fights`, list.filter((l) => l.scheduledRounds === ctx.rounds)),
    make("h2h", "Rematch", list.filter((l) => l.opponentId === ctx.opponentId)),
  ];
}

export function SampleBadge({ f }: { f: UfcPropsFighter }) {
  if (f.sample === "solid") return null;
  return (
    <span className="ml-1.5 rounded bg-amber-400/15 px-1 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-amber-700 ring-1 ring-amber-400/40 dark:text-amber-300">
      {f.sample === "debut" ? "UFC debut" : `${f.ufcFights} UFC fight${f.ufcFights === 1 ? "" : "s"}`}
    </span>
  );
}

interface Row {
  f: UfcPropsFighter;
  point: number;
  chance: number;
  mean: number;
  l5: ReturnType<typeof tallyPropHits>;
  recent: boolean[];
}

function rowFor(f: UfcPropsFighter, stat: UfcPropStatDef, side: PropDirection, logs: UfcFightLog[]): Row {
  const proj = f.projections[stat.key];
  const point = ufcPropLine(proj);
  const over = ufcPropOver(proj, point);
  const values = played(logs).slice(0, 5).map((l) => stat.value(l.mine!));
  return { f, point, chance: side === "over" ? over : 1 - over, mean: proj.mean, l5: tallyPropHits(values, point, side), recent: values.map((v) => (side === "over" ? v > point : v < point)) };
}

function FighterCard({ row, stat, side, logs, bout, onOpen }: { row: Row; stat: UfcPropStatDef; side: PropDirection; logs: UfcFightLog[]; bout?: UfcPropsBout; onOpen: () => void }) {
  const { f } = row;
  const splits = ufcSplits(logs, stat, row.point, side, { rounds: bout?.rounds ?? 3, opponentId: f.opponentId, asOf: asOf(bout, logs) });
  const strip = splits.filter((x) => ["l3", "lastSeason", "venue", "h2h"].includes(x.key) && x.rate.sampleSize > 0);
  return (
    <PropCard
      onOpen={onOpen}
      headshot={f.photo ? [f.photo] : []}
      name={f.name}
      badges={<SampleBadge f={f} />}
      sub={
        <>
          vs {f.opponent}
          {bout && <span className="shrink-0">· {day(bout.eventDate)}</span>}
        </>
      }
      value={row.point}
      unit={stat.shortLabel}
      under={
        <>
          proj <span className="font-mono font-semibold text-foreground">{row.mean.toFixed(1)}</span> · {Math.round(f.projections[stat.key].expectedMinutes)} min
        </>
      }
      meter={<HitMeter recent={row.recent} rate={row.l5} window="L5" slots={5} />}
      price={<ArchrLineChip label={`${side === "over" ? "O" : "U"} ${pct(row.chance)}`} price={fair(row.chance)} />}
      strip={strip.map((x) => (
        <span key={x.key}>
          {x.label} <span className={`font-mono font-semibold ${rateTone(x.rate)}`}>{formatRate(x.rate)}</span>
        </span>
      ))}
      stripRight={<span>UFC {f.ufcRecord}</span>}
    />
  );
}

function Bar({ label, value, max, tone = "bg-brand" }: { label: string; value: number | null; max: number; tone?: string }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-muted">
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, ((value ?? 0) / (max || 1)) * 100)}%` }} />
      </span>
      <span className="text-right font-mono font-semibold text-foreground">{value === null ? "—" : value < 1 && max <= 1 ? pct(value) : value.toFixed(1)}</span>
    </div>
  );
}

/** The fighter's metrics: last 5 vs UFC career vs his division, where his strikes land, and his output by round. */
function MetricsPanel({ f, logs }: { f: UfcPropsFighter; logs: UfcFightLog[] }) {
  const l5 = ufcCareerNumbers(logs.slice(0, 5));
  const all = ufcCareerNumbers(logs);
  const div = f.prior;
  if (!all.fights)
    return (
      <SheetSection title="Fighter metrics" brand>
        <div className="rounded-xl border border-border bg-card p-3.5 text-sm text-muted-foreground">
          No UFC fights with stats yet. Every number here starts from the {f.prior ? "weight class" : "league"} average: {num(div.sig * 15, 0)} significant strikes, {num(div.td * 15, 1)} takedowns and {num(div.kd * 15, 2)} knockdowns per 15 minutes, a{" "}
          {pct(div.finish)} finish rate.
        </div>
      </SheetSection>
    );
  const rows: [string, (s: typeof all) => string, string | null][] = [
    ["Sig. strikes landed / min", (s) => num(s.slpm, 2), num(div.sig, 2)],
    ["Sig. strikes absorbed / min", (s) => num(s.sapm, 2), num(div.sig, 2)],
    ["Striking accuracy", (s) => pct(s.strAcc), null],
    ["Striking defense", (s) => pct(s.strDef), null],
    ["Takedowns / 15 min", (s) => num(s.td15, 2), num(div.td * 15, 2)],
    ["Takedown accuracy", (s) => pct(s.tdAcc), null],
    ["Takedown defense", (s) => pct(s.tdDef), null],
    ["Knockdowns / 15 min", (s) => num(s.kd15, 2), num(div.kd * 15, 2)],
    ["Sub attempts / 15 min", (s) => num(s.sub15, 2), null],
    ["Control time share", (s) => pct(s.ctrlShare), null],
    ["Avg fight time", (s) => (s.avgMinutes === null ? "—" : clock(s.avgMinutes * 60)), null],
  ];
  const maxRound = Math.max(1, ...f.byRound.map((r) => r.avg));
  return (
    <SheetSection title="Fighter metrics" brand>
      <div className="rounded-xl border border-border bg-card p-3.5">
        <div className="grid grid-cols-[1fr_3.6rem_3.6rem_3.6rem] gap-y-1.5 text-sm">
          <span />
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">L5</span>
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">UFC · {all.fights}</span>
          <span className="text-right text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Div avg</span>
          {rows.map(([label, get, d]) => (
            <Fragment key={label}>
              <span className="text-muted-foreground">{label}</span>
              <span className="text-right font-mono font-semibold text-foreground">{get(l5)}</span>
              <span className="text-right font-mono text-foreground/80">{get(all)}</span>
              <span className="text-right font-mono text-muted-foreground">{d ?? ""}</span>
            </Fragment>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Where he lands</p>
            <Bar label="Head" value={all.head} max={1} />
            <Bar label="Body" value={all.body} max={1} />
            <Bar label="Legs" value={all.leg} max={1} />
          </div>
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">From where</p>
            <Bar label="Distance" value={all.distance} max={1} tone="bg-sky-500" />
            <Bar label="Clinch" value={all.clinch} max={1} tone="bg-sky-500" />
            <Bar label="Ground" value={all.ground} max={1} tone="bg-sky-500" />
          </div>
        </div>
        {f.byRound.length > 0 && (
          <div className="mt-4 space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Sig. strikes landed by round (avg)</p>
            {f.byRound.map((r) => (
              <Bar key={r.round} label={`R${r.round} · ${r.n}`} value={r.avg} max={maxRound} tone="bg-emerald-500" />
            ))}
          </div>
        )}
      </div>
    </SheetSection>
  );
}

function methodMix(logs: UfcFightLog[], result: "W" | "L") {
  const l = logs.filter((x) => x.result === result);
  const c = (re: RegExp) => l.filter((x) => re.test(x.method ?? "")).length;
  return `${c(/ko|tko/i)} KO · ${c(/sub/i)} SUB · ${c(/dec/i)} DEC`;
}

function Sheet({ f, bout, logs, opponentLogs, initialStat, side: initialSide, onClose }: { f: UfcPropsFighter; bout?: UfcPropsBout; logs: UfcFightLog[]; opponentLogs: UfcFightLog[]; initialStat: UfcPropStat; side: PropDirection; onClose: () => void }) {
  const [statKey, setStatKey] = useState<UfcPropStat>(initialStat);
  const [side, setSide] = useState(initialSide);
  const [pointBy, setPointBy] = useState<Partial<Record<UfcPropStat, number>>>({});
  const stat = UFC_PROP_STAT_BY_KEY.get(statKey)!;
  const proj = f.projections[statKey];
  const main = ufcPropLine(proj);
  const point = pointBy[statKey] ?? main;
  const over = ufcPropOver(proj, point);
  const rounds = bout?.rounds ?? 3;
  const splits = ufcSplits(logs, stat, point, side, { rounds, opponentId: f.opponentId, asOf: asOf(bout, logs) });
  const step = statKey === "sigStrikes" ? Math.max(5, Math.round(main / 6 / 5) * 5) : 1;
  const ladder = [-3, -2, -1, 0, 1, 2, 3].map((d) => main + d * step).filter((p) => p > 0);
  const tape = played(logs);
  const own = f.ownWeight[statKey];
  const rate = statKey === "sigStrikes" ? f.rates.sig : statKey === "takedowns" ? f.rates.td : f.rates.kd;
  const divRate = statKey === "sigStrikes" ? f.prior.sig : statKey === "takedowns" ? f.prior.td : f.prior.kd;

  return (
    <PlayerSheet
      name={f.name}
      headshot={f.photo ? [f.photo] : []}
      badges={<SampleBadge f={f} />}
      sub={
        <>
          vs {f.opponent}
          {bout && <> · {bout.weightClass} · {rounds} rds · {day(bout.eventDate)}</>}
        </>
      }
      stats={UFC_PROP_STATS.map((x) => ({ key: x.key, label: x.shortLabel }))}
      stat={statKey}
      onStat={(k) => setStatKey(k as UfcPropStat)}
      onClose={onClose}
    >
      <div className="grid grid-cols-4 gap-2 text-center">
        {[
          ["Record", f.record ?? `UFC ${f.ufcRecord}`],
          ["Age", f.age === null ? "—" : String(Math.floor(f.age))],
          ["Reach", f.reachInches === null ? "—" : `${f.reachInches}"`],
          ["Stance", f.stance ?? "—"],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-muted/60 px-2 py-1.5">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">{k}</p>
            <p className="truncate font-mono text-sm font-semibold text-foreground">{v}</p>
          </div>
        ))}
      </div>

      <LinePicker
        label={stat.label}
        value={point}
        side={side}
        onSide={setSide}
        ladder={ladder.map((p) => {
          const o = ufcPropOver(proj, p);
          const c = side === "over" ? o : 1 - o;
          return { point: p, main: p === main, sub: `${pct(c)} · ${fair(c)}` };
        })}
        point={point}
        onPoint={(p) => setPointBy((v) => ({ ...v, [statKey]: p }))}
      />

      <ProjectedNote>
        <span className="font-semibold">ARCHR&apos;s price.</span> {`${main} is ARCHR's line`}, where Over and Under are closest to even.
        {f.sample === "debut"
          ? ` ${surname(f.name)} has no UFC fights, so his numbers start at the ${bout?.weightClass.toLowerCase() ?? "division"} average, tilted by what ${surname(f.opponent)} allows — backtested, that still beats the division average alone for debuts.`
          : f.sample === "thin"
            ? ` Thin sample: ${f.ufcFights} UFC fight${f.ufcFights === 1 ? "" : "s"} (${Math.round(f.ufcMinutes)} min), so his own tape is ${pct(own)} of the rate and his division's average the rest.`
            : ""}
      </ProjectedNote>

      {tape.length > 0 && (
        <SheetSection title={`${stat.label} by fight`} brand>
          <PropGameChart
            logs={tape.map((l) => ({ ...l, opponent: surname(l.opponent), isHome: false, season: Number(l.date.slice(0, 4)), volume: Math.round(l.seconds / 60) }))}
            value={(l) => stat.value(l.mine!)}
            statShort={stat.shortLabel}
            point={point}
            side={side}
            season={asOf(bout, logs).getUTCFullYear()}
            projection={proj.mean}
            opponent={surname(f.opponent)}
            venue={null}
            volumeLabel="min"
            lineLabel="ARCHR line"
          />
        </SheetSection>
      )}

      <ProjectionCard
        headline={proj.mean.toFixed(1)}
        unit={stat.shortLabel}
        swing={`over ~${proj.expectedMinutes.toFixed(1)} of ${rounds * 5} minutes`}
        point={point}
        probOver={over}
        ev={null}
        factors={[
          { label: "His rate / min", value: rate.toFixed(statKey === "knockdowns" ? 3 : 2) },
          { label: `${surname(f.opponent)} allows`, value: `×${proj.opponentFactor.toFixed(2)}` },
          { label: "Exp. minutes", value: proj.expectedMinutes.toFixed(1) },
          { label: "Finish chance", value: pct(proj.pFinish) },
        ]}
        footnote={
          <>
            His per-minute rate over his UFC fights (recent ones count more), steadied toward the division&apos;s {divRate.toFixed(statKey === "knockdowns" ? 3 : 2)}/min — his tape is {pct(own)} of it — × what{" "}
            {surname(f.opponent)} allows, over how long the fight should last (both men&apos;s finish rates). Fitted on every UFC fight since 2010.{" "}
            <Link href="/models" className="font-semibold text-foreground underline-offset-2 hover:underline">
              How accurate is it?
            </Link>
          </>
        }
      />

      {tape.length > 0 && (
        <SheetSection title="Hit rates">
          <SplitGrid splits={splits} />
        </SheetSection>
      )}

      <MetricsPanel f={f} logs={logs} />

      <SheetSection title="Matchup">
        <MatchupFacts
          rows={[
            { label: `${surname(f.opponent)} absorbs`, value: `${f.opponentRates.sigAllowed.toFixed(2)} sig/min`, note: `division ${f.prior.sig.toFixed(2)}`, tone: f.opponentRates.sigAllowed > f.prior.sig * 1.1 ? "good" : f.opponentRates.sigAllowed < f.prior.sig * 0.9 ? "bad" : "neutral" },
            { label: `${surname(f.opponent)} gives up TDs`, value: `${(f.opponentRates.tdAllowed * 15).toFixed(2)} / 15`, note: `division ${(f.prior.td * 15).toFixed(2)}`, tone: f.opponentRates.tdAllowed > f.prior.td * 1.15 ? "good" : f.opponentRates.tdAllowed < f.prior.td * 0.85 ? "bad" : "neutral" },
            { label: "Finish chance", value: pct(proj.pFinish), note: `division ${pct(f.prior.finish)}` },
            { label: `${surname(f.name)} wins`, value: methodMix(logs, "W"), note: `loses ${methodMix(logs, "L")}` },
            { label: `${surname(f.opponent)} wins`, value: methodMix(opponentLogs, "W"), note: `loses ${methodMix(opponentLogs, "L")}` },
          ]}
        />
      </SheetSection>

      <BooksTable point={point} books={[]} pairs={[]} side={side} bestBook={null} fairProbOver={null} projected />

      {tape.length > 0 && (
        <RecentGames
          rows={tape.slice(0, 10).map((l) => ({ date: l.date, opponent: `${surname(l.opponent)} ${l.result} ${methodShort(l.method)}${l.round ? ` R${l.round}` : ""}`, isHome: true, volume: clock(l.seconds), value: stat.value(l.mine!) }))}
          statShort={stat.shortLabel}
          volumeLabel="Time"
          point={point}
          side={side}
          title="Last 10 fights"
        />
      )}

      <SheetFooter />
    </PlayerSheet>
  );
}

/** Every fighter on the upcoming cards: ARCHR's line on significant strikes, takedowns and knockdowns, with the full fighter sheet a tap away. */
export function UfcPropsFinder({ slate, initialBout = null }: { slate: UfcPropsSlate; initialBout?: string | null }) {
  const [statKey, setStatKey] = useState<UfcPropStat>("sigStrikes");
  const [side, setSide] = useState<PropDirection>("over");
  const [sort, setSort] = useState<Sort>("projection");
  const [boutId, setBoutId] = useState<string | null>(slate.bouts.some((b) => b.id === initialBout) ? initialBout : null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const boutById = useMemo(() => new Map(slate.bouts.map((b) => [b.id, b])), [slate.bouts]);
  const stat = UFC_PROP_STAT_BY_KEY.get(statKey)!;
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const out: Row[] = [];
    for (const f of Object.values(slate.fighters)) {
      if ((boutId && f.boutId !== boutId) || (needle && !f.name.toLowerCase().includes(needle))) continue;
      out.push(rowFor(f, stat, side, slate.logs[f.fighterId] ?? []));
    }
    const key = (r: Row) => (sort === "chance" ? r.chance : sort === "projection" ? (side === "over" ? r.mean : -r.mean) : (r.l5.hitRate ?? -1) + r.chance / 100);
    return out.sort((a, b) => key(b) - key(a));
  }, [slate, stat, side, sort, boutId, query]);
  const openF = open ? slate.fighters[open] : null;
  const corner = (n: string, photo: string | null) => ({ name: n, abbreviation: surname(n), mark: initials(n), logoUrl: photo });

  return (
    <>
      <PropsControls
        stats={UFC_PROP_STATS.map((x) => ({ key: x.key, label: x.shortLabel }))}
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
      <GameChips allLabel="All fights" separator="v" games={slate.bouts.map((b) => ({ id: b.id, away: corner(b.red.name, b.red.photo), home: corner(b.blue.name, b.blue.photo), start: day(b.eventDate) }))} active={boutId} onSelect={setBoutId} />
      {rows.length > 0 && <ListNote>ARCHR&apos;s line and chance for every fighter on the card · tap a fighter for his full metrics sheet</ListNote>}
      {rows.length === 0 ? (
        <EmptyList title={query ? `No fighters match “${query}”` : "No upcoming fights"} hint="Cards show as soon as the bouts are announced." />
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {rows.map((r) => (
            <FighterCard key={r.f.id} row={r} stat={stat} side={side} logs={slate.logs[r.f.fighterId] ?? []} bout={boutById.get(r.f.boutId)} onOpen={() => setOpen(r.f.id)} />
          ))}
        </ul>
      )}
      {openF && <Sheet key={openF.id} f={openF} bout={boutById.get(openF.boutId)} logs={slate.logs[openF.fighterId] ?? []} opponentLogs={slate.logs[openF.opponentId] ?? []} initialStat={statKey} side={side} onClose={close} />}
    </>
  );
}

const OPEN_EVENT = "ufc:open-fighter";

/** Wraps a fighter's badge on the bout page: tapping it opens his sheet. */
export function OpenFighterButton({ fighterId, children, label }: { fighterId: string; children: ReactNode; label: string }) {
  return (
    <button type="button" aria-label={`${label} — fighter sheet`} onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: fighterId }))} className="rounded-full transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {children}
    </button>
  );
}

/** The bout page's fighter props: both fighters on one stat, and the sheet behind either one (or his badge above). */
export function UfcBoutProps({ slate }: { slate: UfcPropsSlate }) {
  const [statKey, setStatKey] = useState<UfcPropStat>("sigStrikes");
  const [side, setSide] = useState<PropDirection>("over");
  const [open, setOpen] = useState<string | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const bout = slate.bouts[0];
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const f = Object.values(slate.fighters).find((x) => x.fighterId === id);
      if (f) setOpen(f.id);
    };
    window.addEventListener(OPEN_EVENT, on);
    const q = new URLSearchParams(window.location.search).get("fighter");
    if (q) on(new CustomEvent(OPEN_EVENT, { detail: q }));
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, [slate.fighters]);
  if (!bout) return null;
  const stat = UFC_PROP_STAT_BY_KEY.get(statKey)!;
  const fighters = Object.values(slate.fighters);
  const openF = open ? slate.fighters[open] : null;
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-extrabold uppercase italic tracking-tight text-foreground">{bout.completed ? "Fighter sheets" : "Fighter props"}</h2>
        <Segmented options={sideOptions()} value={side} onChange={setSide} />
      </div>
      <Segmented options={UFC_PROP_STATS.map((x) => ({ key: x.key, label: x.shortLabel }))} value={statKey} onChange={setStatKey} />
      <ul className="mt-3 flex flex-col gap-2.5">
        {fighters.map((f) => (
          <FighterCard key={f.id} row={rowFor(f, stat, side, slate.logs[f.fighterId] ?? [])} stat={stat} side={side} logs={slate.logs[f.fighterId] ?? []} bout={bout} onOpen={() => setOpen(f.id)} />
        ))}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">
        {bout.completed ? "What ARCHR projected going in, from each fighter's earlier fights. " : ""}Tap a fighter (or his photo above) for every fight, rate and split.{" "}
        <Link href={`/ufc/props?bout=${bout.id}`} className="font-semibold text-foreground underline-offset-2 hover:underline">
          All fighter props ›
        </Link>
      </p>
      {openF && <Sheet key={openF.id} f={openF} bout={bout} logs={slate.logs[openF.fighterId] ?? []} opponentLogs={slate.logs[openF.opponentId] ?? []} initialStat={statKey} side={side} onClose={close} />}
    </section>
  );
}
