import type { Metadata } from "next";
import Link from "next/link";
import { SportCarousel } from "@/components/book/SportCarousel";
import { Glyph, type GlyphKey } from "@/components/brand/Glyph";
import { AutoSubmitForm } from "@/components/screener/AutoSubmitForm";
import { FilterPanel } from "@/components/screener/FilterPanel";
import { getScreenerPool, SCREENER_SPORTS } from "@/lib/screener/pool";
import { DEFAULT_FILTERS, SCREEN_WINDOWS, barsOf, screen, type Rate, type ScreenFilters, type ScreenSort, type ScreenWindow, type ScreenerProp } from "@/lib/screener/types";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { refreshOnView } from "@/lib/ops/refreshOnView";

export const metadata: Metadata = {
  title: "Player Props — every sport, screened by hit rate",
  description:
    "Player props for every sport ARCHR models, with a screener: hit rate over the last 3, 5, 10, 15 games, this season and last, by sport, game, team and stat, with ARCHR's chance and every book's price.",
};

export const dynamic = "force-dynamic";

/** Every sport with a props product, in lineup order. */
const PROPS: { sport: GlyphKey; label: string; href: string }[] = [
  { sport: "nba", label: "NBA", href: "/nba/props" },
  { sport: "nfl", label: "NFL", href: "/nfl/props" },
  { sport: "ufc", label: "UFC", href: "/ufc/props" },
  { sport: "soccer", label: "Soccer", href: "/sports/soccer/props" },
  { sport: "tennis", label: "Tennis", href: "/sports/tennis/props" },
  { sport: "mlb", label: "MLB", href: "/mlb/props" },
  { sport: "hockey", label: "NHL", href: "/player-props/lines?league=hockey%2Fnhl" },
];

type Params = Partial<Record<"sport" | "game" | "team" | "stat" | "side" | "line" | "all" | "games" | "archr" | "edge" | "pmin" | "pmax" | "sort" | ScreenWindow, string>>;

const BARS = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const MIN_GAMES = [3, 5, 8, 10];
const ARCHR = [0, 0.5, 0.55, 0.6, 0.7, 0.8];
const EDGES = ["any", "0", "0.03", "0.05", "0.1"];
const PRICES = [-1000, -500, -300, -200, -150, -110, 100, 150, 200, 300];
const SORTS: { key: ScreenSort; label: string }[] = [
  ...SCREEN_WINDOWS.map((w) => ({ key: w.key as ScreenSort, label: `${w.label} rate` })),
  { key: "archr", label: "ARCHR chance" },
  { key: "edge", label: "ARCHR edge" },
  { key: "price", label: "Longest price" },
];
const ROWS = 150;

const num = (v: string | undefined, allowed: number[], d: number) => (v !== undefined && allowed.includes(Number(v)) ? Number(v) : d);

function readFilters(p: Params): ScreenFilters {
  const min: Partial<Record<ScreenWindow, number>> = {};
  for (const { key } of SCREEN_WINDOWS) {
    const v = num(p[key], BARS, 0);
    if (v) min[key] = v;
  }
  return {
    ...DEFAULT_FILTERS,
    sport: p.sport && SCREENER_SPORTS.some((s) => s.key === p.sport) ? p.sport : null,
    gameId: p.game || null,
    team: p.team || null,
    stat: p.stat || null,
    side: p.side === "over" || p.side === "under" || p.side === "yes" ? p.side : null,
    mainOnly: p.line !== "all",
    min,
    all: num(p.all, BARS, 0),
    minGames: num(p.games, MIN_GAMES, DEFAULT_FILTERS.minGames),
    minArchr: num(p.archr, ARCHR, 0),
    minEdge: p.edge && EDGES.includes(p.edge) && p.edge !== "any" ? Number(p.edge) : null,
    shortest: p.pmin && PRICES.includes(Number(p.pmin)) ? Number(p.pmin) : null,
    longest: p.pmax && PRICES.includes(Number(p.pmax)) ? Number(p.pmax) : null,
    sort: SORTS.some((s) => s.key === p.sort) ? (p.sort as ScreenSort) : DEFAULT_FILTERS.sort,
  };
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const selectClass = "mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-foreground";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

function RateCell({ rate, bar }: { rate: Rate; bar: number | undefined }) {
  const [h, n] = rate;
  if (!n) return <td className="px-1.5 py-2 text-center font-mono text-[11px] text-muted-foreground">—</td>;
  const r = h / n;
  const tone = r >= Math.max(bar ?? 0.7, 0.7) ? "text-emerald-600 dark:text-emerald-400" : r < 0.5 ? "text-muted-foreground" : "text-foreground";
  return (
    <td className={`px-1.5 py-2 text-center font-mono text-[11px] ${tone}`}>
      <span className="font-semibold">{pct(r)}</span>
      <span className="block text-[10px] text-muted-foreground">
        {h}/{n}
      </span>
    </td>
  );
}

function sideText(p: ScreenerProp): string {
  if (p.side === "yes") return `${p.statLabel} Yes`;
  return `${p.side === "over" ? "Over" : "Under"} ${p.point} ${p.statLabel}`;
}

/**
 * The Props tab: a door to each sport's board, and the screener — every prop
 * on the board (NBA, NFL, soccer), filtered by a hit-rate bar on any window
 * (L3, L5, L10, L15, this season, last season, or all of them at once), sport,
 * game, team, stat and side, main line or alt rungs, ARCHR's chance and edge,
 * and price. The filters live in the URL, so the server does the screening and
 * a screen is shareable.
 */
export default async function PlayerPropsHubPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  await refreshOnView([["espn-props", 30]]);
  const read = readFilters(params);
  const pool = await getScreenerPool(read.sport);
  // A game, team or stat left over from another sport would screen everything out: drop it.
  const f: ScreenFilters = {
    ...read,
    gameId: read.gameId && pool.some((p) => p.gameId === read.gameId) ? read.gameId : null,
    team: read.team && pool.some((p) => p.team === read.team) ? read.team : null,
    stat: read.stat && pool.some((p) => p.stat === read.stat) ? read.stat : null,
  };
  // Options narrow with the sport (and the teams and stats with the game).
  const inGame = f.gameId ? pool.filter((p) => p.gameId === f.gameId) : pool;
  const games = [...new Map(pool.map((p) => [p.gameId, { id: p.gameId, label: `${f.sport ? "" : `${p.league} · `}${p.game}`, at: p.startsAt }])).values()].sort((a, b) => a.at.localeCompare(b.at));
  const teams = [...new Set(inGame.map((p) => p.team))].filter(Boolean).sort();
  const stats = [...new Map(inGame.map((p) => [p.stat, `${f.sport ? "" : `${p.league.length <= 3 ? p.league : "Soccer"} `}${p.statLabel}`])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const results = screen(pool, f);
  const bars = barsOf(f);
  const active = [f.sport, f.gameId, f.team, f.stat, f.side, f.mainOnly ? null : "alt", f.all || null, ...Object.values(f.min), f.minArchr || null, f.minEdge, f.shortest, f.longest].filter((v) => v !== null && v !== undefined && v !== 0).length;

  return (
    <div className="mx-auto min-h-screen w-full min-w-0 max-w-6xl px-4 pb-24 pt-5 font-sans">
      <SportCarousel active="all" />
      <h1 className="mt-5 font-display text-3xl font-extrabold uppercase italic leading-none tracking-tight text-foreground">Player Props</h1>
      <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {PROPS.map((p) => (
          <Link key={p.href} href={p.href} className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/70">
            <Glyph name={p.sport} className="size-4" />
            {p.label}
          </Link>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        <Link href="/parlay-builder" className="font-semibold text-foreground underline-offset-2 hover:underline">Parlay Builder</Link> ·{" "}
        <Link href="/nba/parlays" className="font-semibold text-foreground underline-offset-2 hover:underline">NBA</Link> and{" "}
        <Link href="/nfl/parlays" className="font-semibold text-foreground underline-offset-2 hover:underline">NFL</Link> Parlay Finders ·{" "}
        <Link href="/player-props/lines" className="font-semibold text-foreground underline-offset-2 hover:underline">Book prop lines</Link>
      </p>

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <FilterPanel
          active={active}
          className="group rounded-xl border border-border bg-card p-3 lg:sticky lg:top-4 lg:self-start"
          summary={
            <>
              Filters {active > 0 && <span className="ml-1 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] text-background">{active}</span>}
              <span className="float-right text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
            </>
          }
        >
          <AutoSubmitForm action="/player-props" className="mt-3 flex flex-col gap-3">
            <Field label="Sport">
              <select name="sport" defaultValue={f.sport ?? ""} className={selectClass}>
                <option value="">All sports</option>
                {SCREENER_SPORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Game">
              <select name="game" defaultValue={f.gameId ?? ""} className={selectClass}>
                <option value="">All games</option>
                {games.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Team">
              <select name="team" defaultValue={f.team ?? ""} className={selectClass}>
                <option value="">All teams</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Stat">
              <select name="stat" defaultValue={f.stat ?? ""} className={selectClass}>
                <option value="">All stats</option>
                {stats.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Side">
                <select name="side" defaultValue={f.side ?? ""} className={selectClass}>
                  <option value="">Any</option>
                  <option value="over">Over</option>
                  <option value="under">Under</option>
                  <option value="yes">Yes</option>
                </select>
              </Field>
              <Field label="Lines">
                <select name="line" defaultValue={f.mainOnly ? "" : "all"} className={selectClass}>
                  <option value="">Main line</option>
                  <option value="all">+ alt lines</option>
                </select>
              </Field>
            </div>

            <div className="border-t border-border pt-3">
              <Field label="Every window at least">
                <select name="all" defaultValue={String(f.all)} className={selectClass}>
                  {BARS.map((b) => (
                    <option key={b} value={b}>
                      {b ? `${pct(b)}+` : "No bar"}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {SCREEN_WINDOWS.map((w) => (
                  <Field key={w.key} label={w.label}>
                    <select name={w.key} defaultValue={String(f.min[w.key] ?? 0)} className={selectClass}>
                      {BARS.map((b) => (
                        <option key={b} value={b}>
                          {b ? `${pct(b)}+` : "Any"}
                        </option>
                      ))}
                    </select>
                  </Field>
                ))}
              </div>
              <div className="mt-2">
                <Field label="Fewest games in a window">
                  <select name="games" defaultValue={String(f.minGames)} className={selectClass}>
                    {MIN_GAMES.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
              <Field label="ARCHR chance">
                <select name="archr" defaultValue={String(f.minArchr)} className={selectClass}>
                  {ARCHR.map((a) => (
                    <option key={a} value={a}>
                      {a ? `${pct(a)}+` : "Any"}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="ARCHR edge">
                <select name="edge" defaultValue={f.minEdge === null ? "any" : String(f.minEdge)} className={selectClass}>
                  {EDGES.map((e) => (
                    <option key={e} value={e}>
                      {e === "any" ? "Any" : `+${Math.round(Number(e) * 100)}%`}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Price from">
                <select name="pmin" defaultValue={f.shortest === null ? "" : String(f.shortest)} className={selectClass}>
                  <option value="">Any</option>
                  {PRICES.map((p) => (
                    <option key={p} value={p}>
                      {formatAmerican(p)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Price to">
                <select name="pmax" defaultValue={f.longest === null ? "" : String(f.longest)} className={selectClass}>
                  <option value="">Any</option>
                  {PRICES.map((p) => (
                    <option key={p} value={p}>
                      {formatAmerican(p)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Sort by">
              <select name="sort" defaultValue={f.sort} className={selectClass}>
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-center justify-between gap-2">
              <button type="submit" className="rounded-lg bg-foreground px-3 py-1.5 text-xs font-semibold text-background">
                Apply
              </button>
              <Link href="/player-props" className="text-xs font-semibold text-muted-foreground hover:text-foreground">
                Clear all
              </Link>
            </div>
          </AutoSubmitForm>
        </FilterPanel>

        <section className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {results.length.toLocaleString()} of {pool.length.toLocaleString()} props pass
            {results.length > ROWS ? ` · the top ${ROWS} shown` : ""}
          </p>
          {results.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-border p-6 text-center">
              <p className="text-sm font-semibold text-foreground">No props pass these filters</p>
              <p className="mt-1 text-xs text-muted-foreground">Lower a bar, widen the price range, include alt lines, or clear a filter.</p>
            </div>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[720px] text-left text-xs">
                <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Player · prop</th>
                    <th className="px-2 py-2 text-right font-semibold">Price</th>
                    {SCREEN_WINDOWS.map((w) => (
                      <th key={w.key} className={`px-1.5 py-2 text-center font-semibold ${bars[w.key] ? "text-foreground" : ""}`}>
                        {w.label}
                      </th>
                    ))}
                    <th className="px-2 py-2 text-center font-semibold">ARCHR</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {results.slice(0, ROWS).map((p) => (
                    <tr key={p.id} className="bg-card">
                      <td className="px-3 py-2">
                        <Link href={p.href} className="font-semibold text-foreground hover:underline">
                          {p.player}
                        </Link>
                        <span className="ml-1.5 text-muted-foreground">{sideText(p)}</span>
                        {!p.main && <span className="ml-1.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">alt</span>}
                        <span className="block text-[11px] text-muted-foreground">
                          {p.league} · {p.team} vs {p.opponent} · {p.game}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right font-mono">
                        {p.priceAmerican !== null ? formatAmerican(p.priceAmerican) : "—"}
                        {p.bookName && <span className="block font-sans text-[10px] text-muted-foreground">{p.bookName}</span>}
                      </td>
                      {SCREEN_WINDOWS.map((w) => (
                        <RateCell key={w.key} rate={p.rates[w.key]} bar={bars[w.key]} />
                      ))}
                      <td className="px-2 py-2 text-center font-mono text-[11px]">
                        {p.archr !== null ? pct(p.archr) : "—"}
                        {p.edge !== null && p.priceAmerican !== null && (
                          <span className={`block text-[10px] ${p.edge > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                            {p.edge > 0 ? "+" : ""}
                            {(p.edge * 100).toFixed(1)}%
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Each window is how often the prop cashed at tonight&apos;s number in the player&apos;s games: the last 3, 5, 10 and 15, this season and
            last. A window with fewer games than the floor you set can&apos;t meet its bar. Soccer keeps a player&apos;s last ten matches here, so its
            L15 and season columns read &quot;—&quot;. Prices are the best one posted (&quot;—&quot;: a number posted before its price, or
            ARCHR&apos;s own line before the books post). ARCHR&apos;s edge is its chance against that price. Research only.
          </p>
        </section>
      </div>
    </div>
  );
}
