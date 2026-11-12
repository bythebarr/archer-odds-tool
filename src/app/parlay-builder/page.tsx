import type { Metadata } from "next";
import Link from "next/link";
import { getBuilderPool } from "@/lib/builder/pool";
import { buildParlays, inScope, legConservativeEdge, type BuilderOptions, type BuilderSort, type BuiltParlay } from "@/lib/builder/build";
import { optimizeParlays, type OptimizedParlay } from "@/lib/builder/optimize";
import type { BuilderLeg, BuilderWindow } from "@/lib/builder/types";
import { ALL_SPORTS } from "@/lib/allSports/sports";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { CANONICAL_NUMBERS, cautiousReadMath, edgeFromChance } from "@/lib/propModel/canonical";

/** Hover note on every cautious number here: what it is, and that it isn't a chance. */
const CAUTIOUS_NOTE = `${CANONICAL_NUMBERS.cautiousEdge.label}: ${cautiousReadMath}, over the window. Not a probability.`;
import { refreshOnView } from "@/lib/ops/refreshOnView";
import { ScrollRow } from "@/components/ScrollRow";
import { ParlayGenerator } from "@/components/builder/ParlayGenerator";
import { AutoSubmitForm } from "@/components/screener/AutoSubmitForm";
import { scopeOptions } from "@/lib/builder/scope";
import { parseStatList, statTiles } from "@/lib/props/statTiles";
import { StatTileLinks } from "@/components/props/StatTiles";

/** A render that runs this long has stalled (pools are pre-built: lib/pools): end it rather than let stalled calls pile up. */
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Parlay Builder — legs that clear your hit rate and ARCHR's bar, every sport",
  description: "Build parlays from player props, moneylines, spreads and totals across every sport, filtered by hit rate over the sample you pick and ARCHR's chance and edge.",
};

export const dynamic = "force-dynamic";

type Params = { mode?: string; pay?: string; n?: string; sports?: string; game?: string; team?: string; xstat?: string; legs?: string; window?: string; rate?: string; archr?: string; edge?: string; short?: string; sgp?: string; sort?: string };

/** Payouts the optimizer aims for (American), and its leg counts. */
const PAYOUTS = [100, 200, 300, 500, 750, 1000, 2000, 5000];
const OPT_LEGS = ["any", "2", "3", "4", "5", "6", "8"];

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
  { key: "cedge", label: "Cautious edge" },
];
const DEFAULTS = { legs: 4, window: "l10" as BuilderWindow, rate: 0.7, archr: 0, edge: "any", short: "-500", sgp: false, sort: "archr" as BuilderSort };

const SPORT_LABEL: Record<string, string> = { nba: "NBA", nfl: "NFL", mlb: "MLB", ufc: "UFC", ...Object.fromEntries(ALL_SPORTS.map((s) => [s.key, s.label])) };
const SPORT_ORDER = ["nba", "nfl", "mlb", "ufc", ...ALL_SPORTS.map((s) => s.key)];

function readOptions(p: Params): BuilderOptions & { edgeKey: string; shortKey: string; mode: "gen" | "bars" | "payout"; pay: number; n: string } {
  const num = (v: string | undefined, allowed: number[], d: number) => (v !== undefined && allowed.includes(Number(v)) ? Number(v) : d);
  const edgeKey = EDGES.some((e) => e.key === p.edge) ? p.edge! : DEFAULTS.edge;
  const shortKey = SHORTEST.some((e) => e.key === p.short) ? p.short! : DEFAULTS.short;
  return {
    sports: (p.sports ?? "").split(",").filter(Boolean),
    game: p.game || undefined,
    team: p.team || undefined,
    excludeStats: parseStatList(p.xstat),
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
    // Generate is the default: the tool most people come for.
    mode: p.mode === "payout" ? "payout" : p.mode === "bars" ? "bars" : "gen",
    pay: num(p.pay, PAYOUTS, 500),
    n: OPT_LEGS.includes(p.n ?? "") ? p.n! : "any",
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

function LegRow({ l, window, prob }: { l: BuilderLeg; window: BuilderWindow; prob?: number }) {
  const [h, n] = l.rates[window];
  const cedge = legConservativeEdge(l, window);
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
          {prob !== undefined && (
            <span title={CAUTIOUS_NOTE}>
              {" "}
              · caut. {pct(prob)}
            </span>
          )}
        </p>
        {cedge !== null && (
          <p className={`text-[10px] ${cedge > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`} title={CAUTIOUS_NOTE}>
            {CANONICAL_NUMBERS.cautiousEdge.shortLabel.toLowerCase()} {cedge > 0 ? "+" : ""}
            {(cedge * 100).toFixed(1)}%
          </p>
        )}
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

function OptimizedCard({ p, window, index, target }: { p: OptimizedParlay; window: BuilderWindow; index: number; target: number }) {
  // EDGE comes from ARCHR chance only (lib/propModel/canonical); the cautious product ranks, it isn't priced.
  const edge = edgeFromChance(p.archr, p.priceAmerican);
  return (
    <li className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-3 pt-3">
        <p className="text-sm font-semibold text-foreground">
          #{index + 1} · {p.legs.length} legs <span className="ml-2 font-mono text-foreground">{formatAmerican(p.priceAmerican)}</span>
          {p.priceAmerican > target * 1.15 && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">(over your {formatAmerican(target)})</span>}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {p.archr !== null && (
            <>
              {CANONICAL_NUMBERS.archrChance.label} <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{(p.archr * 100).toFixed(1)}%</span>
              {" · "}
            </>
          )}
          {edge !== null && (
            <>
              {CANONICAL_NUMBERS.edge.label}{" "}
              <span className={`font-mono ${edge > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
                {edge >= 0 ? "+" : ""}
                {(edge * 100).toFixed(1)}%
              </span>
              {" · "}
            </>
          )}
          <span title={CAUTIOUS_NOTE}>
            cautious score <span className="font-mono text-foreground">{(p.prob * 100).toFixed(1)}%</span> — ranking only
          </span>
        </p>
      </div>
      <ul className="mt-2 divide-y divide-border border-t border-border">
        {p.legs.map((l) => (
          <LegRow key={l.id} l={l} window={window} prob={l.prob} />
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
  await refreshOnView([["sync-injuries", 20], ["espn-props", 30], ["espn-odds", 30]]);
  const o = readOptions(params);
  const pool = await getBuilderPool();
  // The Game and Team menus; a pick that's no longer on the board (or outside the sports chosen) is dropped.
  const scope = scopeOptions(pool, o.sports, o.game);
  if (o.game && !scope.games.some((g) => g.id === o.game)) o.game = undefined;
  if (o.team && !scope.teams.some((t) => t.key === o.team)) o.team = undefined;
  // One game (or one team's game) can only make a same-game parlay.
  const narrowed = Boolean(o.game || o.team);
  if (narrowed) o.sameGame = true;
  const allScope = scopeOptions(pool, []);
  // The stat tiles: every prop stat among the legs in scope (sports, game, team), all on unless switched off.
  const statLegs = pool.filter((l) => l.kind === "prop" && l.stat && inScope(l, { ...o, excludeStats: [] }));
  // The generator's tiles follow its own Sports/Game/Team picks: prop legs counted per game, team and stat.
  const statCounts = new Map<string, { sport: string; stat: string; event: string; teams: string[]; n: number }>();
  for (const l of pool) {
    if (l.kind !== "prop" || !l.stat) continue;
    const k = `${l.eventId}|${(l.teams ?? []).join(",")}|${l.stat}`;
    const c = statCounts.get(k) ?? statCounts.set(k, { sport: l.sport, stat: l.stat, event: l.eventId, teams: l.teams ?? [], n: 0 }).get(k)!;
    c.n++;
  }
  const statItems = [...statCounts.values()];
  const tiles = statTiles(
    statLegs.map((l) => ({ sport: l.sport, stat: l.stat!, label: l.stat! })),
    (s) => SPORT_LABEL[s] ?? s.toUpperCase()
  );
  const payout = o.mode === "payout";
  const gen = o.mode === "gen";
  const { qualifying, parlays } = payout || gen ? { qualifying: 0, parlays: [] } : buildParlays(pool, o);
  const optimized = payout
    ? optimizeParlays(pool, {
        target: o.pay,
        legs: o.n === "any" ? null : Number(o.n),
        sports: o.sports,
        game: o.game,
        team: o.team,
        excludeStats: o.excludeStats,
        window: o.window,
        sameGame: o.sameGame,
        shortest: o.shortest,
      })
    : null;

  const counts = new Map<string, number>();
  for (const l of pool) counts.set(l.sport, (counts.get(l.sport) ?? 0) + 1);
  const sports = [...new Set([...counts.keys(), ...o.sports])].sort((a, b) => (SPORT_ORDER.indexOf(a) + 1 || 999) - (SPORT_ORDER.indexOf(b) + 1 || 999));

  const href = (change: Partial<Params>) => {
    const next: Params = {
      sports: o.sports.join(","),
      game: o.game ?? "",
      team: o.team ?? "",
      xstat: (o.excludeStats ?? []).join(","),
      legs: String(o.legs),
      window: o.window,
      rate: String(o.minRate),
      archr: String(o.minArchr),
      edge: o.edgeKey,
      short: o.shortKey,
      sgp: o.sameGame ? "1" : "",
      sort: o.sort,
      mode: o.mode === "gen" ? "" : o.mode,
      pay: String(o.pay),
      n: o.n,
      ...change,
    };
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v !== undefined && v !== "") as [string, string][]);
    return `/parlay-builder?${qs.toString()}`;
  };
  // Every other setting, carried through the Game / Team form.
  const keep = Object.fromEntries(new URLSearchParams(href({ game: undefined, team: undefined }).split("?")[1]).entries());
  delete keep.game;
  delete keep.team;
  const selectClass = "w-full rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground";
  const toggleSport = (s: string) => (o.sports.includes(s) ? o.sports.filter((x) => x !== s) : [...o.sports, s]).join(",");

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 pb-24 pt-5 font-sans">
      <h1 className="font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight text-foreground">Parlay Builder</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {gen
          ? "Pick your legs and filters, generate, lock the legs you like and regenerate the rest, from every sport on the board."
          : payout
            ? "Pick the payout you want; it finds the legs most likely to get you there, from every sport on the board."
            : "Set your bars; it stacks the legs that clear them, from every sport on the board."}
      </p>
      <div className="mt-3 flex max-w-md gap-1 rounded-full bg-muted p-1">
        <Link scroll={false} href={href({ mode: "" })} className={`flex-1 rounded-full px-3 py-1.5 text-center text-xs font-semibold ${gen ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
          Generate
        </Link>
        <Link scroll={false} href={href({ mode: "bars" })} className={`flex-1 rounded-full px-3 py-1.5 text-center text-xs font-semibold ${o.mode === "bars" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
          Build by bars
        </Link>
        <Link scroll={false} href={href({ mode: "payout" })} className={`flex-1 rounded-full px-3 py-1.5 text-center text-xs font-semibold ${payout ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>
          Hit a payout
        </Link>
      </div>

      {gen && (
        <ParlayGenerator
          sports={sports.map((s) => ({ key: s, label: SPORT_LABEL[s] ?? s, count: counts.get(s) ?? 0 }))}
          games={allScope.games.map((g) => ({ id: g.id, sport: g.sport, label: `${g.label} · ${startLabel(g.startsAt)}`, teams: g.teams }))}
          teams={allScope.teams.map((t) => ({ key: t.key, sport: t.sport, label: t.label }))}
          sportLabels={SPORT_LABEL}
          statItems={statItems}
        />
      )}
      {!gen && (
        <>
      <Row title="Sports">
        <Link scroll={false} href={href({ sports: "", game: "", team: "" })} className={chip(o.sports.length === 0)}>
          All sports
        </Link>
        {sports.map((s) => (
          <Link key={s} scroll={false} href={href({ sports: toggleSport(s), game: "", team: "" })} className={chip(o.sports.includes(s))}>
            {SPORT_LABEL[s] ?? s} <span className="opacity-60">{counts.get(s) ?? 0}</span>
          </Link>
        ))}
      </Row>
      <AutoSubmitForm action="/parlay-builder" className="mt-3 grid grid-cols-2 gap-2">
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Game</span>
          <select key={`g:${o.game ?? ""}`} name="game" defaultValue={o.game ?? ""} className={selectClass}>
            <option value="">All games</option>
            {scope.games.map((g) => (
              <option key={g.id} value={g.id}>
                {o.sports.length === 1 ? "" : `${SPORT_LABEL[g.sport] ?? g.sport} · `}
                {g.label} · {startLabel(g.startsAt)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Team</span>
          <select key={`t:${o.team ?? ""}:${o.game ?? ""}`} name="team" defaultValue={o.team ?? ""} className={selectClass}>
            <option value="">All teams</option>
            {scope.teams.map((t) => (
              <option key={t.key} value={t.key}>
                {o.sports.length === 1 ? "" : `${SPORT_LABEL[t.sport] ?? t.sport} · `}
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <noscript>
          <button type="submit" className="col-span-2 rounded-lg bg-foreground px-3 py-2 text-xs font-semibold text-background">
            Apply
          </button>
        </noscript>
      </AutoSubmitForm>
      <div className="mt-4">
        <StatTileLinks tiles={tiles} excluded={o.excludeStats ?? []} href={(off) => href({ xstat: off.join(",") })} />
      </div>
      {payout && (
        <>
          <Row title="Payout you want (at least)">
            {PAYOUTS.map((v) => (
              <Link key={v} scroll={false} href={href({ pay: String(v) })} className={chip(o.pay === v)}>
                {formatAmerican(v)}
              </Link>
            ))}
          </Row>
          <Row title="Legs">
            {OPT_LEGS.map((n) => (
              <Link key={n} scroll={false} href={href({ n })} className={chip(o.n === n)}>
                {n === "any" ? "Any (2–8)" : n}
              </Link>
            ))}
          </Row>
        </>
      )}
      {!payout && (
      <Row title="Legs">
        {LEG_COUNTS.map((n) => (
          <Link key={n} scroll={false} href={href({ legs: String(n) })} className={chip(o.legs === n)}>
            {n}
          </Link>
        ))}
      </Row>
      )}
      {!payout && (
      <Row title="Each leg has hit at least">
        {RATES.map((r) => (
          <Link key={r} scroll={false} href={href({ rate: String(r) })} className={chip(o.minRate === r)}>
            {pct(r)}
          </Link>
        ))}
      </Row>
      )}
      <Row title={payout ? "Record window behind each leg's estimate" : "Over"}>
        {WINDOWS.map((w) => (
          <Link key={w.key} scroll={false} href={href({ window: w.key })} className={chip(o.window === w.key)}>
            {w.label}
          </Link>
        ))}
      </Row>
      {!payout && (
        <>
      <Row title="ARCHR chance per leg">
        {ARCHR.map((a) => (
          <Link key={a} scroll={false} href={href({ archr: String(a) })} className={chip(o.minArchr === a)}>
            {a === 0 ? "Any" : `${pct(a)}+`}
          </Link>
        ))}
      </Row>
      <Row title="ARCHR edge per leg">
        {EDGES.map((e) => (
          <Link key={e.key} scroll={false} href={href({ edge: e.key })} className={chip(o.edgeKey === e.key)}>
            {e.label}
          </Link>
        ))}
      </Row>
        </>
      )}
      <Row title="Shortest leg">
        {SHORTEST.map((e) => (
          <Link key={e.key} scroll={false} href={href({ short: e.key })} className={chip(o.shortKey === e.key)}>
            {e.label}
          </Link>
        ))}
      </Row>
      {!payout && (
      <Row title="Rank by">
        {SORTS.map((s) => (
          <Link key={s.key} scroll={false} href={href({ sort: s.key })} className={chip(o.sort === s.key)}>
            {s.label}
          </Link>
        ))}
      </Row>
      )}
      <Row title={narrowed ? "Same game (on: one game or team picked)" : "Same game"}>
        <Link scroll={false} href={href({ sgp: "" })} className={chip(!o.sameGame)}>
          One leg per game
        </Link>
        <Link scroll={false} href={href({ sgp: "1" })} className={chip(o.sameGame)}>
          Allow same-game legs
        </Link>
      </Row>

      {optimized ? (
        <>
          <p className="mt-4 text-xs text-muted-foreground">
            {optimized.candidates.toLocaleString()} priced legs searched · the likeliest parlays paying {formatAmerican(o.pay)} or more
          </p>
          {optimized.parlays.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-border p-6 text-center">
              <p className="text-sm font-semibold text-foreground">No combination reaches {formatAmerican(o.pay)} here</p>
              <p className="mt-1 text-xs text-muted-foreground">Allow more legs, shorter-priced legs, more sports, or same-game legs.</p>
            </div>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {optimized.parlays.map((p, i) => (
                <OptimizedCard key={p.legs.map((l) => l.id).join("|")} p={p} window={o.window} index={i} target={o.pay} />
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
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
        </>
      )}

      <p className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
        A leg&apos;s record is how often the same bet cashed over the sample: a prop at tonight&apos;s number in the player&apos;s games, a moneyline,
        spread or total at tonight&apos;s number in the teams&apos; games (for UFC, the fighter&apos;s fights). An edge above 50% is left out of the
        edge filter and ranking: ARCHR disagreeing with the book that much is the model&apos;s weak spot (alt lines, mostly), not a bet. Legs from different games are treated as
        independent, so the parlay&apos;s ARCHR chance and record are the legs&apos; multiplied. Prices are the best one posted; &quot;—&quot; is a line posted
        before its price. ARCHR chance is the one probability for every leg — the model blended with the books&apos; no-vig consensus — and ARCHR&apos;s edge is that chance against the best price. Hit a payout: each leg is read cautiously (&ldquo;caut.&rdquo;) — {cautiousReadMath}, over the window — and the optimizer searches every
        combination (one leg per game) for the highest cautious score (the legs&apos; cautious reads multiplied) whose price pays at least what
        you picked; the alternatives below it each leave one of its legs out. The cautious score ranks, it isn&apos;t a chance: the parlay&apos;s
        chance is its ARCHR chance, and its edge is ARCHR edge. Legs whose price is far longer than their cautious read (more than +50% cautious
        edge) are left out: that gap is a price that doesn&apos;t belong to the line. The cautious edge compares a leg&apos;s cautious read with the
        chance its price implies — ranking only, for sorting and building, not a probability. Research only.
      </p>
        </>
      )}
    </div>
  );
}
