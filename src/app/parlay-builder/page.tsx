import type { Metadata } from "next";
import Link from "next/link";
import { getBuilderPool } from "@/lib/builder/pool";
import { buildParlays, type BuilderOptions, type BuilderSort, type BuiltParlay } from "@/lib/builder/build";
import type { BuilderLeg, BuilderWindow } from "@/lib/builder/types";
import { ALL_SPORTS } from "@/lib/allSports/sports";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { refreshOnView } from "@/lib/ops/refreshOnView";
import { ScrollRow } from "@/components/ScrollRow";

export const metadata: Metadata = {
  title: "Parlay Builder — legs that clear your hit rate and ARCHR's bar, every sport",
  description: "Build parlays from player props, moneylines, spreads and totals across every sport, filtered by hit rate over the sample you pick and ARCHR's chance and edge.",
};

export const dynamic = "force-dynamic";

type Params = { sports?: string; legs?: string; window?: string; rate?: string; archr?: string; edge?: string; short?: string; sgp?: string; sort?: string };

const LEG_COUNTS = [2, 3, 4, 5, 6, 8, 10, 12, 15];
const WINDOWS: { key: BuilderWindow; label: string }[] = [
  { key: "l5", label: "Last 5" },
  { key: "l10", label: "Last 10" },
  { key: "l20", label: "Last 20" },
  { key: "season", label: "Season" },
];
const RATES = [0.6, 0.7, 0.8, 0.9, 1];
const SHORTEST: { key: string; label: string }[] = [
  { key: "-200", label: "−200" },
  { key: "-300", label: "−300" },
  { key: "-500", label: "−500" },
  { key: "-1000", label: "−1000" },
  { key: "any", label: "Any" },
];
const ARCHR = [0, 0.55, 0.6, 0.7, 0.8];
const EDGES: { key: string; label: string }[] = [
  { key: "any", label: "Any" },
  { key: "0", label: "+0%" },
  { key: "0.03", label: "+3%" },
  { key: "0.05", label: "+5%" },
  { key: "0.1", label: "+10%" },
];
const SORTS: { key: BuilderSort; label: string }[] = [
  { key: "archr", label: "ARCHR chance" },
  { key: "hit", label: "Hit rate" },
  { key: "edge", label: "ARCHR edge" },
];
const DEFAULTS = { legs: 4, window: "l10" as BuilderWindow, rate: 0.7, archr: 0, edge: "any", short: "-500", sgp: false, sort: "archr" as BuilderSort };

const SPORT_LABEL: Record<string, string> = { nba: "NBA", nfl: "NFL", ufc: "UFC", ...Object.fromEntries(ALL_SPORTS.map((s) => [s.key, s.label])) };
const SPORT_ORDER = ["nba", "nfl", "ufc", ...ALL_SPORTS.map((s) => s.key)];

function readOptions(p: Params): BuilderOptions & { edgeKey: string; shortKey: string } {
  const num = (v: string | undefined, allowed: number[], d: number) => (v !== undefined && allowed.includes(Number(v)) ? Number(v) : d);
  const edgeKey = EDGES.some((e) => e.key === p.edge) ? p.edge! : DEFAULTS.edge;
  const shortKey = SHORTEST.some((e) => e.key === p.short) ? p.short! : DEFAULTS.short;
  return {
    sports: (p.sports ?? "").split(",").filter(Boolean),
    legs: num(p.legs, LEG_COUNTS, DEFAULTS.legs),
    window: WINDOWS.some((w) => w.key === p.window) ? (p.window as BuilderWindow) : DEFAULTS.window,
    minRate: num(p.rate, RATES, DEFAULTS.rate),
    minArchr: num(p.archr, ARCHR, DEFAULTS.archr),
    minEdge: edgeKey === "any" ? null : Number(edgeKey),
    edgeKey,
    shortest: shortKey === "any" ? -Infinity : Number(shortKey),
    shortKey,
    sameGame: p.sgp === "1",
    sort: SORTS.some((s) => s.key === p.sort) ? (p.sort as BuilderSort) : DEFAULTS.sort,
  };
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const chip = (active: boolean) =>
  `shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`;

function startLabel(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ScrollRow className="-mx-4 flex gap-2 px-4 pb-1">{children}</ScrollRow>
    </div>
  );
}

function LegRow({ l, window }: { l: BuilderLeg; window: BuilderWindow }) {
  const [h, n] = l.rates[window];
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
      <div className="min-w-0">
        <p className="truncate">
          <span className="mr-1.5 rounded bg-muted px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">{l.league}</span>
          <Link href={l.href} className="font-semibold text-foreground hover:underline">
            {l.label}
          </Link>
        </p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {l.eventLabel} · {startLabel(l.startsAt)}
        </p>
      </div>
      <div className="shrink-0 text-right font-mono">
        <p className="text-foreground">
          {l.priceAmerican !== null ? formatAmerican(l.priceAmerican) : "—"}
          {l.bookName && <span className="ml-1 font-sans text-[10px] text-muted-foreground">{l.bookName}</span>}
        </p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {h}/{n}
          {l.archr !== null && <> · ARCHR {pct(l.archr)}</>}
        </p>
      </div>
    </li>
  );
}

function ParlayCard({ p, window, index }: { p: BuiltParlay; window: BuilderWindow; index: number }) {
  return (
    <li className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 pt-3">
        <p className="text-sm font-semibold text-foreground">
          #{index + 1} · {p.legs.length} legs
          {p.priceAmerican !== null && <span className="ml-2 font-mono text-foreground">{formatAmerican(p.priceAmerican)}</span>}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {p.archr !== null && (
            <>
              ARCHR <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{pct(p.archr)}</span>
              {" · "}
            </>
          )}
          records <span className="font-mono text-foreground">{pct(p.record)}</span>
          {p.edge !== null && (
            <>
              {" · "}edge <span className="font-mono text-foreground">{p.edge >= 0 ? "+" : ""}{(p.edge * 100).toFixed(1)}%</span>
            </>
          )}
        </p>
      </div>
      <ul className="mt-2 divide-y divide-border border-t border-border">
        {p.legs.map((l) => (
          <LegRow key={l.id} l={l} window={window} />
        ))}
      </ul>
    </li>
  );
}

/**
 * The parlay builder: every sport's legs (player props, moneylines, spreads,
 * totals) in one pool, filtered by the bars you set — sports, legs, the hit
 * rate over the sample you pick, ARCHR's chance and edge — and stacked into
 * parlays. Every control is a link, so the page renders on the server and a
 * build is shareable by URL.
 */
export default async function ParlayBuilderPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  await refreshOnView([["espn-props", 30], ["espn-odds", 30]]);
  const o = readOptions(params);
  const pool = await getBuilderPool();
  const { qualifying, parlays } = buildParlays(pool, o);

  const counts = new Map<string, number>();
  for (const l of pool) counts.set(l.sport, (counts.get(l.sport) ?? 0) + 1);
  const sports = [...new Set([...counts.keys(), ...o.sports])].sort((a, b) => (SPORT_ORDER.indexOf(a) + 1 || 999) - (SPORT_ORDER.indexOf(b) + 1 || 999));

  const href = (change: Partial<Params>) => {
    const next: Params = {
      sports: o.sports.join(","),
      legs: String(o.legs),
      window: o.window,
      rate: String(o.minRate),
      archr: String(o.minArchr),
      edge: o.edgeKey,
      short: o.shortKey,
      sgp: o.sameGame ? "1" : "",
      sort: o.sort,
      ...change,
    };
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v !== undefined && v !== "") as [string, string][]);
    return `/parlay-builder?${qs.toString()}`;
  };
  const toggleSport = (s: string) => (o.sports.includes(s) ? o.sports.filter((x) => x !== s) : [...o.sports, s]).join(",");

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-24 pt-5 font-sans">
      <h1 className="font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight text-foreground">Parlay Builder</h1>
      <p className="mt-2 text-sm text-muted-foreground">Set your bars; it stacks the legs that clear them, from every sport on the board.</p>

      <Row title="Sports">
        <Link href={href({ sports: "" })} className={chip(o.sports.length === 0)}>
          All sports
        </Link>
        {sports.map((s) => (
          <Link key={s} href={href({ sports: toggleSport(s) })} className={chip(o.sports.includes(s))}>
            {SPORT_LABEL[s] ?? s} <span className="opacity-60">{counts.get(s) ?? 0}</span>
          </Link>
        ))}
      </Row>
      <Row title="Legs">
        {LEG_COUNTS.map((n) => (
          <Link key={n} href={href({ legs: String(n) })} className={chip(o.legs === n)}>
            {n}
          </Link>
        ))}
      </Row>
      <Row title="Each leg has hit at least">
        {RATES.map((r) => (
          <Link key={r} href={href({ rate: String(r) })} className={chip(o.minRate === r)}>
            {pct(r)}
          </Link>
        ))}
      </Row>
      <Row title="Over">
        {WINDOWS.map((w) => (
          <Link key={w.key} href={href({ window: w.key })} className={chip(o.window === w.key)}>
            {w.label}
          </Link>
        ))}
      </Row>
      <Row title="ARCHR chance per leg">
        {ARCHR.map((a) => (
          <Link key={a} href={href({ archr: String(a) })} className={chip(o.minArchr === a)}>
            {a === 0 ? "Any" : `${pct(a)}+`}
          </Link>
        ))}
      </Row>
      <Row title="ARCHR edge per leg">
        {EDGES.map((e) => (
          <Link key={e.key} href={href({ edge: e.key })} className={chip(o.edgeKey === e.key)}>
            {e.label}
          </Link>
        ))}
      </Row>
      <Row title="Shortest leg">
        {SHORTEST.map((e) => (
          <Link key={e.key} href={href({ short: e.key })} className={chip(o.shortKey === e.key)}>
            {e.label}
          </Link>
        ))}
      </Row>
      <Row title="Rank by">
        {SORTS.map((s) => (
          <Link key={s.key} href={href({ sort: s.key })} className={chip(o.sort === s.key)}>
            {s.label}
          </Link>
        ))}
      </Row>
      <Row title="Same game">
        <Link href={href({ sgp: "" })} className={chip(!o.sameGame)}>
          One leg per game
        </Link>
        <Link href={href({ sgp: "1" })} className={chip(o.sameGame)}>
          Allow same-game legs
        </Link>
      </Row>

      <p className="mt-4 text-xs text-muted-foreground">
        {qualifying.toLocaleString()} of {pool.length.toLocaleString()} legs clear your bars
      </p>

      {parlays.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-sm font-semibold text-foreground">Not enough legs clear these bars for a {o.legs}-leg parlay</p>
          <p className="mt-1 text-xs text-muted-foreground">Lower the hit rate or ARCHR bar, pick a longer sample, add sports, or allow same-game legs.</p>
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-3">
          {parlays.map((p, i) => (
            <ParlayCard key={p.legs.map((l) => l.id).join("|")} p={p} window={o.window} index={i} />
          ))}
        </ul>
      )}

      <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
        A leg&apos;s record is how often the same bet cashed over the sample: a prop at tonight&apos;s number in the player&apos;s games, a moneyline,
        spread or total at tonight&apos;s number in the teams&apos; games (for UFC, the fighter&apos;s fights). An edge above 50% is left out of the
        edge filter and ranking: ARCHR disagreeing with the book that much is the model&apos;s weak spot (alt lines, mostly), not a bet. Legs from different games are treated as
        independent, so the parlay&apos;s ARCHR chance and record are the legs&apos; multiplied. Prices are the best one posted; &quot;—&quot; is a line posted
        before its price. Research only.
      </p>
    </div>
  );
}
