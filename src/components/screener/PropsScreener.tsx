/**
 * The props screener with its filters column: every prop on the board (or one
 * sport's), filtered by a hit-rate bar on any window (L3, L5, L10, L15, this
 * season, last season, or all of them at once), sport, game, team, stat and
 * side, main line or alt rungs, ARCHR's chance and edge, and price. The filters
 * live in the URL, so the server does the screening and a screen is shareable.
 * Shared by the Props tab and every sport's props page.
 */
import Link from "next/link";
import { AutoSubmitForm } from "@/components/screener/AutoSubmitForm";
import { FilterPanel } from "@/components/screener/FilterPanel";
import { getScreenerPool, SCREENER_SPORTS, type ScreenerSport } from "@/lib/screener/pool";
import { DEFAULT_FILTERS, SCREEN_WINDOWS, screen, type ScreenFilters, type ScreenSort, type ScreenWindow } from "@/lib/screener/types";
import { formatAmerican } from "@/lib/odds/americanOdds";
import { parseStatList, statTiles } from "@/lib/props/statTiles";
import { StatTileLinks } from "@/components/props/StatTiles";
import { getReportedBlendVerdicts, getReportedGraded } from "@/lib/queries/modelTrust";
import { getFrozenPrices } from "@/lib/queries/oddsFeed";
import { trackRecordLabel } from "@/lib/modelBadge";
import { EdgeLineList } from "@/components/book/EdgeLineRow";
import { ScreenerEdgeRow } from "./ScreenerEdgeRow";
import { blendCardKey, propBlendVerdict, propIsUnproven } from "@/lib/props/provenance";

export type ScreenerParams = Partial<Record<"view" | "sport" | "game" | "team" | "stat" | "side" | "line" | "all" | "games" | "archr" | "mins" | "edge" | "pmin" | "pmax" | "sort" | ScreenWindow, string>> & {
  /** Stats switched off on the stat tiles (lib/props/statTiles): comma-separated or repeated. */
  xstat?: string | string[];
};

const BARS = [0, 0.5, 0.6, 0.7, 0.8, 0.9, 1];
const MIN_GAMES = [3, 5, 8, 10];
const ARCHR = [0, 0.5, 0.55, 0.6, 0.7, 0.8];
/** NBA projected minutes, at least. */
const MINUTES = [0, 15, 20, 24, 28, 30, 32, 34, 36];
const EDGES = ["any", "0", "0.03", "0.05", "0.1"];
const PRICES = [-1000, -500, -300, -200, -150, -110, 100, 150, 200, 300];
const SORTS: { key: ScreenSort; label: string }[] = [
  ...SCREEN_WINDOWS.map((w) => ({ key: w.key as ScreenSort, label: `${w.label} rate` })),
  { key: "archr", label: "ARCHR chance" },
  { key: "edge", label: "ARCHR edge" },
  { key: "conf", label: "Confidence" },
  { key: "minutes", label: "Projected minutes (NBA)" },
  { key: "price", label: "Longest price" },
];
const ROWS = 150;

/** The sort bar: edge first. The record windows stay sortable (and filterable) though rows show only the edge. */
const SORT_BAR: [ScreenSort, string][] = [
  ["edge", "Edge"],
  ["archr", "ARCHR"],
  ["conf", "Confidence"],
  ["price", "Price"],
  ["l10", "L10"],
  ["szn", "Season"],
  ["minutes", "Proj min"],
];
const SPORT_LABEL: Record<string, string> = Object.fromEntries(SCREENER_SPORTS.map((s) => [s.key, s.label]));

const num = (v: string | undefined, allowed: number[], d: number) => (v !== undefined && allowed.includes(Number(v)) ? Number(v) : d);

function readFilters(p: ScreenerParams, fixed: ScreenerSport | null): ScreenFilters {
  const min: Partial<Record<ScreenWindow, number>> = {};
  for (const { key } of SCREEN_WINDOWS) {
    const v = num(p[key], BARS, 0);
    if (v) min[key] = v;
  }
  return {
    ...DEFAULT_FILTERS,
    sport: fixed ?? (p.sport && SCREENER_SPORTS.some((s) => s.key === p.sport) ? p.sport : null),
    gameId: p.game || null,
    team: p.team || null,
    stat: p.stat || null,
    excludeStats: parseStatList(p.xstat),
    side: p.side === "over" || p.side === "under" || p.side === "yes" ? p.side : null,
    mainOnly: p.line !== "all",
    min,
    all: num(p.all, BARS, 0),
    minGames: num(p.games, MIN_GAMES, DEFAULT_FILTERS.minGames),
    minArchr: num(p.archr, ARCHR, 0),
    minMinutes: num(p.mins, MINUTES, 0),
    minEdge: p.edge && EDGES.includes(p.edge) && p.edge !== "any" ? Number(p.edge) : null,
    shortest: p.pmin && PRICES.includes(Number(p.pmin)) ? Number(p.pmin) : null,
    longest: p.pmax && PRICES.includes(Number(p.pmax)) ? Number(p.pmax) : null,
    // An older `sort=cedge` link sorts by Confidence, which the cautious read now feeds.
    sort: p.sort === "cedge" ? "conf" : SORTS.some((s) => s.key === p.sort) ? (p.sort as ScreenSort) : DEFAULT_FILTERS.sort,
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





export async function PropsScreener({ params, basePath, sport = null, keep = {} }: { params: ScreenerParams; basePath: string; sport?: ScreenerSport | null; keep?: Record<string, string> }) {
  const read = readFilters(params, sport);
  const [pool, blendVerdicts, graded, frozen] = await Promise.all([getScreenerPool(read.sport, !read.mainOnly), getReportedBlendVerdicts(), getReportedGraded(), getFrozenPrices()]);
  // A game, team or stat left over from another sport would screen everything out: drop it.
  const scoped: ScreenFilters = {
    ...read,
    gameId: read.gameId && pool.some((p) => p.gameId === read.gameId) ? read.gameId : null,
    team: read.team && pool.some((p) => p.team === read.team) ? read.team : null,
  };
  // Options narrow with the sport (and the teams and stats with the game).
  const inGame = scoped.gameId ? pool.filter((p) => p.gameId === scoped.gameId) : pool;
  const games = [...new Map(pool.map((p) => [p.gameId, { id: p.gameId, label: `${scoped.sport ? "" : `${p.league} · `}${p.game}`, at: p.startsAt }])).values()].sort((a, b) => a.at.localeCompare(b.at));
  const teams = [...new Set(inGame.map((p) => p.team))].filter(Boolean).sort();
  // The stat tiles: every stat in scope, all on unless switched off. An older `?stat=` link means "only that stat".
  const tiles = statTiles(
    inGame.filter((p) => !scoped.team || p.team === scoped.team).map((p) => ({ sport: p.sport, stat: p.stat, label: p.statLabel })),
    (s) => SPORT_LABEL[s] ?? s.toUpperCase()
  );
  const excludeStats = read.stat && !read.excludeStats.length ? tiles.filter((t) => !t.key.endsWith(`:${read.stat}`)).map((t) => t.key) : read.excludeStats;
  const f: ScreenFilters = { ...scoped, stat: null, excludeStats };
  const results = screen(pool, f);
  const statsOff = tiles.filter((t) => excludeStats.includes(t.key)).length;
  const active = [sport ? null : f.sport, f.gameId, f.team, statsOff || null, f.side, f.mainOnly ? null : "alt", f.all || null, ...Object.values(f.min), f.minArchr || null, f.minMinutes || null, f.minEdge, f.shortest, f.longest].filter((v) => v !== null && v !== undefined && v !== 0).length;
  const query = new URLSearchParams(keep).toString();
  const clearHref = query ? `${basePath}?${query}` : basePath;
  /** The current screen with the stat tiles replaced (All on / All off). */
  const statsHref = (off: string[]) => {
    const rest = Object.entries(params).filter(([k, v]) => k !== "xstat" && k !== "stat" && typeof v === "string" && v !== "") as [string, string][];
    const qs = new URLSearchParams({ ...Object.fromEntries(rest), ...keep, ...(off.length ? { xstat: off.join(",") } : {}) });
    return `${basePath}?${qs.toString()}`;
  };
  /** The same screen sorted by another column (the table's headers are links). */
  const sortHref = (sort: ScreenSort) => {
    const rest = Object.entries(params).filter(([k, v]) => k !== "xstat" && k !== "stat" && typeof v === "string" && v !== "") as [string, string][];
    const qs = new URLSearchParams({ ...Object.fromEntries(rest), ...keep, ...(excludeStats.length ? { xstat: excludeStats.join(",") } : {}), sort });
    return `${basePath}?${qs.toString()}`;
  };

  return (
    <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <FilterPanel
        active={active}
        className="group rounded-xl border border-border bg-card p-3 lg:sticky lg:top-[72px] lg:max-h-[calc(100vh-88px)] lg:self-start lg:overflow-y-auto lg:overscroll-contain"
        summary={
          <>
            Filters {active > 0 && <span className="ml-1 rounded-full bg-foreground px-1.5 py-0.5 text-[10px] text-background">{active}</span>}
            <span className="float-right text-xs font-normal text-muted-foreground group-open:hidden">Show</span>
          </>
        }
      >
        <AutoSubmitForm action={basePath} className="mt-3 flex flex-col gap-3">
          {Object.entries(keep).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {!sport && (
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
          )}
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
          {/* The tiles are links (one param, comma-joined); the form carries the same selection for its other filters. */}
          {excludeStats.length > 0 && <input type="hidden" name="xstat" value={excludeStats.join(",")} />}
          <StatTileLinks tiles={tiles} excluded={excludeStats} href={statsHref} />
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

          {(!sport || sport === "nba") && (
            <div className="border-t border-border pt-3">
              <Field label="NBA projected minutes">
                <select name="mins" defaultValue={String(f.minMinutes)} className={selectClass}>
                  {MINUTES.map((m) => (
                    <option key={m} value={m}>
                      {m ? `${m}+ minutes` : "Any"}
                    </option>
                  ))}
                </select>
              </Field>
              <p className="mt-1 text-[10px] leading-snug text-muted-foreground">Role, teammates out, back-to-backs, returns from a miss and blowout risk, if he plays.</p>
            </div>
          )}

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
            <Link href={clearHref} className="text-xs font-semibold text-muted-foreground hover:text-foreground">
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
          <>
            <nav aria-label="Sort" className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="font-semibold uppercase tracking-wide text-muted-foreground">Sort</span>
              {SORT_BAR.map(([key, label]) => (
                <Link
                  key={key}
                  href={sortHref(key)}
                  scroll={false}
                  aria-current={f.sort === key ? "true" : undefined}
                  className={`rounded-full px-2.5 py-1 font-semibold transition-colors ${f.sort === key ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground"}`}
                >
                  {label}
                </Link>
              ))}
            </nav>
            <EdgeLineList className="mt-2">
              {results.slice(0, ROWS).map((p) => (
                <ScreenerEdgeRow
                  key={p.id}
                  p={p}
                  frozen={frozen}
                  provenance={propIsUnproven(p, blendVerdicts) ? trackRecordLabel(propBlendVerdict(p.sport, p.stat, blendVerdicts), graded[blendCardKey(p.sport, p.stat)]) : null}
                />
              ))}
            </EdgeLineList>
          </>
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
          Each row leads with ARCHR&apos;s edge: its chance against the best price. The record windows (the last 3, 5, 10 and 15 games, this season and
          last) filter and sort the list but live on the player sheet, along with minutes, injury tags and every factor behind the grade. A window with fewer games than the floor you set can&apos;t meet its bar. Soccer keeps a player&apos;s last ten matches here, so its
          L15 and season columns read &quot;—&quot;. UFC and tennis have no book prop lines in the feed: they&apos;re screened at ARCHR&apos;s own line, and a fighter&apos;s season is the calendar year. Prices are the best one posted (&quot;—&quot;: a number posted before its price). ARCHR chance is the one probability on this page — the model&apos;s projection blended with the books&apos; no-vig consensus; for NBA, then corrected for running high on the side it leans (overs and alt lines most), a fix checked on thousands of tracked picks it wasn&apos;t fitted on — and ARCHR&apos;s edge is that chance against the best price. Confidence (A–D) says how far to trust that chance and edge on this prop, not how likely it is: it weighs the stat&apos;s report card, how much history the projection has, whether his record at this line backs the price (the old cautious edge, now one factor), how far ARCHR sits from the books, his minutes, injury tags and alt lines. Hover a grade for what moved it; open the player for every reason. NBA projected minutes (if he plays) weigh his latest games and current role, discount nights he left early, and adjust for teammates out, back-to-backs, his first game back after missing time and blowout risk from the spread: off by about 5.4 minutes on average over two seasons, against 5.5 for his last-10 average. Where a prop&apos;s ARCHR number is priced by the market blend, the line under the row gives that blend&apos;s report card from /models (Trusted, Marginal, Thin or Not graded yet, with how many outcomes it was graded on). Confidence reads &quot;B · 62&quot;: grade, then score out of 100, underlined while grades are not yet validated. Research only.
        </p>
      </section>
    </div>
  );
}
