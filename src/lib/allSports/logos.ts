/**
 * A logo for any team or player in any sport, found once and cached on the
 * Competitor row:
 *
 *   1. ESPN's crest (synced per league by espn.ts)
 *   2. the team's Wikipedia infobox image (a crest for clubs, a photo for players),
 *      accepted only when the page is described as that sport's team or player
 *   3. nothing — the badge shows initials
 *
 * Misses are remembered for 30 days so a team without a crest costs one lookup a month.
 */
import { prisma } from "@/lib/prisma";
import { allSportOrDefault } from "./sports";
import { bestMatch, canonicalName, teamKey } from "./names";

const UA = "ARCHR-Edge/1.0 (sports analytics; https://github.com/bythebarr/archer-odds-tool)";
const RETRY_MS = 30 * 86_400_000;

/** How Wikipedia describes a team or player of each sport — the guard against namesakes. */
const DESCRIBED_AS: Record<string, RegExp> = {
  soccer: /football|soccer/i,
  futsal: /futsal/i,
  "beach-soccer": /soccer|football/i,
  tennis: /tennis/i,
  basketball: /basketball/i,
  hockey: /hockey/i,
  football: /football/i,
  baseball: /baseball/i,
  cricket: /cricket/i,
  "rugby-league": /rugby/i,
  "rugby-union": /rugby/i,
  rugby: /rugby/i,
  "aussie-rules": /australian|football/i,
  esports: /esports|e-sports|gaming|counter-strike|league of legends|dota|valorant/i,
  darts: /darts/i,
  "table-tennis": /table tennis/i,
  snooker: /snooker/i,
  volleyball: /volleyball/i,
  handball: /handball/i,
  boxing: /boxer|boxing/i,
  mma: /mixed martial|fighter/i,
  golf: /golf/i,
  badminton: /badminton/i,
  lacrosse: /lacrosse/i,
};

/** Search terms that steer Wikipedia to the club, not the town. */
const SEARCH_SUFFIX: Record<string, string> = {
  soccer: "football club",
  hockey: "ice hockey team",
  basketball: "basketball team",
  football: "football team",
  baseball: "baseball team",
  cricket: "cricket team",
  "rugby-league": "rugby league club",
  "rugby-union": "rugby union team",
  "aussie-rules": "football club",
  esports: "esports",
  handball: "handball club",
  volleyball: "volleyball",
};

interface WikiPage {
  title: string;
  index?: number;
  description?: string;
  thumbnail?: { source: string };
  original?: { source: string };
}

/**
 * Wikipedia search → the best page's image, if the page is that sport's team or
 * player. For a person (an individual sport) the page title must carry their
 * surname too, so "Luke Humphries" never stands in for "Luke Littler". Exported for tests.
 */
export function pickWikiImage(pages: WikiPage[], sport: string, name: string): string | null {
  const guard = DESCRIBED_AS[sport];
  const individual = allSportOrDefault(sport).family === "winner" && !/esports|cricket|volleyball|curling/.test(sport);
  const surname = canonicalName(name).split(" ").at(-1) ?? "";
  const ranked = [...pages].sort((a, b) => (a.index ?? 99) - (b.index ?? 99));
  for (const p of ranked.slice(0, 3)) {
    const img = p.thumbnail?.source ?? p.original?.source;
    if (!img) continue;
    if (guard && !(guard.test(p.description ?? "") || guard.test(p.title))) continue;
    if (individual && !canonicalName(p.title).split(" ").includes(surname)) continue;
    return img;
  }
  return null;
}

/** The image URL, null when Wikipedia has nothing for this name, undefined when it couldn't answer (rate limit, outage) — try again later. */
export async function wikipediaLogo(name: string, sport: string): Promise<string | null | undefined> {
  const pages = await wikiSearch(`${name} ${SEARCH_SUFFIX[sport] ?? allSportOrDefault(sport).label}`);
  return pages === undefined ? undefined : pickWikiImage(pages, sport, name);
}

/**
 * A team-sport player's photo: the page must be described as a footballer (or
 * whatever `describedAs` says) and carry his surname. Same answers as wikipediaLogo.
 */
export async function wikipediaPlayerPhoto(name: string, describedAs: RegExp, searchSuffix: string): Promise<string | null | undefined> {
  const pages = await wikiSearch(`${name} ${searchSuffix}`);
  if (pages === undefined) return undefined;
  const surname = canonicalName(name).split(" ").at(-1) ?? "";
  for (const p of [...pages].sort((a, b) => (a.index ?? 99) - (b.index ?? 99)).slice(0, 3)) {
    const img = p.thumbnail?.source ?? p.original?.source;
    if (img && describedAs.test(p.description ?? "") && canonicalName(p.title).split(" ").includes(surname)) return img;
  }
  return null;
}

async function wikiSearch(q: string): Promise<WikiPage[] | undefined> {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  for (const [k, v] of Object.entries({
    action: "query", format: "json", formatversion: "2", generator: "search", gsrsearch: q, gsrlimit: "3",
    prop: "pageimages|description", piprop: "thumbnail", pithumbsize: "256", pilicense: "any",
  })) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate: 60 * 60 * 24 * 7 } });
  if (!res.ok) return undefined;
  const body = (await res.json()) as { query?: { pages?: WikiPage[] } };
  return body.query?.pages ?? [];
}

/**
 * The cached logo for a team/player, looking it up if it's never been tried (or
 * a miss is over 30 days old). Null when there's none to be had.
 */
export async function competitorLogo(sport: string, name: string, now = new Date()): Promise<string | null> {
  const id = `${sport}/${teamKey(name)}`;
  let row = await prisma.competitor.findUnique({ where: { id } });
  if (!row) {
    // An ESPN-synced name that's spelled differently ("AFC Bournemouth" for "Bournemouth").
    const peers = await prisma.competitor.findMany({ where: { sport, logoUrl: { not: null } }, select: { id: true, name: true, logoUrl: true } });
    const match = bestMatch(name, peers.map((p) => p.name));
    const hit = match ? peers.find((p) => p.name === match) : null;
    if (hit?.logoUrl) {
      await prisma.competitor.create({ data: { id, sport, name, logoUrl: hit.logoUrl, logoSource: "espn", logoCheckedAt: now } }).catch(() => null);
      return hit.logoUrl;
    }
  }
  if (row?.logoUrl) return row.logoUrl;
  if (row?.logoCheckedAt && now.getTime() - row.logoCheckedAt.getTime() < RETRY_MS) return null;
  const found = await wikipediaLogo(name, sport).catch(() => undefined);
  // No answer isn't a miss: don't remember it, ask again next time.
  if (found === undefined) return null;
  row = await prisma.competitor.upsert({
    where: { id },
    create: { id, sport, name, logoUrl: found, logoSource: found ? "wikipedia" : "none", logoCheckedAt: now },
    update: { logoUrl: found, logoSource: found ? "wikipedia" : "none", logoCheckedAt: now },
  });
  return row.logoUrl;
}

/** Logos for many names at once, from the cache only (no lookups) — for list pages. */
export async function cachedLogos(sport: string, names: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(names.map((n) => `${sport}/${teamKey(n)}`))];
  const rows = await prisma.competitor.findMany({ where: { id: { in: ids }, logoUrl: { not: null } }, select: { id: true, logoUrl: true } });
  const byId = new Map(rows.map((r) => [r.id, r.logoUrl!]));
  const out = new Map<string, string>();
  for (const n of names) {
    const hit = byId.get(`${sport}/${teamKey(n)}`);
    if (hit) out.set(n, hit);
  }
  return out;
}

/** The logo URL a page should use: the cached one, else the lookup route (which redirects or 404s). */
export function logoSrc(sport: string, name: string, cached: Map<string, string>): string {
  return cached.get(name) ?? `/api/logo?sport=${encodeURIComponent(sport)}&name=${encodeURIComponent(name)}`;
}

/**
 * Looks up logos for the teams and players in the next few days' games, a
 * second apart, so boards read them from the cache instead of the lookup
 * route. Run from the backfill job; stops at `maxMs`.
 */
export async function warmLogos(maxMs: number, now = new Date()): Promise<number> {
  const started = Date.now();
  const events = await prisma.sportEvent.findMany({
    where: { status: "scheduled", startsAt: { gte: now, lte: new Date(now.getTime() + 4 * 86_400_000) }, league: { outright: false } },
    select: { home: true, away: true, league: { select: { sport: true } } },
    take: 2000,
  });
  const names = new Map<string, { sport: string; name: string }>();
  for (const e of events) for (const n of [e.home, e.away]) names.set(`${e.league.sport}/${teamKey(n)}`, { sport: e.league.sport, name: n });
  const known = new Set((await prisma.competitor.findMany({ where: { id: { in: [...names.keys()] } }, select: { id: true } })).map((c) => c.id));
  let looked = 0;
  for (const [id, { sport, name }] of names) {
    if (known.has(id) || Date.now() - started > maxMs) continue;
    await competitorLogo(sport, name, now);
    looked++;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return looked;
}
