/**
 * Page data for every sport in the all-sports engine: the hub, a sport's board
 * (league chips over game rows), one event's full market and model read, and
 * futures boards.
 */
import { prisma } from "@/lib/prisma";
import { mainOffer, type Offer } from "@/lib/gameModel/offers";
import { americanToImpliedProbability, decimalToAmerican } from "@/lib/odds/americanOdds";
import { BOOK_NAMES } from "@/lib/odds/bookAllowlist";
import { isBettableBook } from "@/lib/odds/bestPrice";
import { ALL_SPORTS, allSportOrDefault, type AllSport } from "@/lib/allSports/sports";
import { leagueRatings, headToHead } from "@/lib/allSports/model/history";
import { archrRead, priceEvent, type ArchrRead, type PricedOffer } from "@/lib/allSports/model/price";
import { nameSimilarity } from "@/lib/allSports/names";
import { lineOutcomeFor } from "@/lib/allSports/model/outcomes";
import type { LeagueRatings, TeamForm } from "@/lib/allSports/model/ratings";
import { cachedLogos, logoSrc } from "@/lib/allSports/logos";

const BOARD_DAYS = 7;

export interface HubSport extends AllSport {
  leagues: number;
  upcoming: number;
  nextAt: Date | null;
}

/** Every sport with a league in season, the busiest first. */
export async function getAllSportsHub(): Promise<HubSport[]> {
  const rows = await prisma.league.groupBy({
    by: ["sport"],
    where: { active: true },
    _count: { _all: true },
    _sum: { upcomingCount: true },
    _min: { nextEventAt: true },
  });
  return rows
    .map((r) => ({ ...allSportOrDefault(r.sport), leagues: r._count._all, upcoming: r._sum.upcomingCount ?? 0, nextAt: r._min.nextEventAt }))
    .sort((a, b) => a.rank - b.rank);
}

/** Sports in the order the switcher shows them, only those with something on. */
export async function activeAllSports(): Promise<AllSport[]> {
  const hub = await getAllSportsHub();
  const live = new Set(hub.map((h) => h.key));
  return ALL_SPORTS.filter((s) => live.has(s.key)).concat(hub.filter((h) => !ALL_SPORTS.some((s) => s.key === h.key)));
}

export interface LeagueChip {
  id: string;
  slug: string;
  name: string;
  region: string | null;
  logoUrl: string | null;
  upcoming: number;
  outright: boolean;
  nextAt: Date | null;
}

export interface BoardSide {
  priceAmerican: number;
  bookKey: string;
  bookName: string;
  label: string;
  point: number;
  ev: number | null;
  fairAmerican: number | null;
}

export interface BoardEvent {
  id: string;
  startsAt: Date;
  status: string;
  home: string;
  away: string;
  homeLogo: string;
  awayLogo: string;
  homeScore: number | null;
  awayScore: number | null;
  /** Columns: moneyline (with draw when 3-way), spread, total — best price and ARCHR edge per side. */
  ml: { home: BoardSide | null; draw: BoardSide | null; away: BoardSide | null };
  spread: { home: BoardSide | null; away: BoardSide | null };
  total: { over: BoardSide | null; under: BoardSide | null };
  /** The biggest edge on the main lines, for the "value" flag. */
  topEdge: number | null;
  markets: number;
  /** ARCHR's own prices from the model — what shows before any book posts. */
  archr: ArchrRead | null;
}

/**
 * An ESPN fixture and the odds feed's copy of the same game (different ids):
 * the feed's, with the prices, wins. Same league, within 3 hours, both names matching.
 */
export function dropEspnTwins<E extends { id: string; leagueId: string; startsAt: Date; home: string; away: string }>(events: E[]): E[] {
  const feed = events.filter((e) => !e.id.startsWith("espn:"));
  return events.filter(
    (e) =>
      !e.id.startsWith("espn:") ||
      !feed.some(
        (f) =>
          f.leagueId === e.leagueId &&
          Math.abs(f.startsAt.getTime() - e.startsAt.getTime()) <= 3 * 3_600_000 &&
          nameSimilarity(f.home, e.home) >= 0.75 &&
          nameSimilarity(f.away, e.away) >= 0.75
      )
  );
}

export interface LeagueBoard {
  league: LeagueChip;
  events: BoardEvent[];
}

const slugOf = (id: string) => id.slice(id.indexOf("/") + 1);

function chip(l: { id: string; name: string; region: string | null; logoUrl: string | null; upcomingCount: number; outright: boolean; nextEventAt: Date | null }): LeagueChip {
  return { id: l.id, slug: slugOf(l.id), name: l.name, region: l.region, logoUrl: l.logoUrl, upcoming: l.upcomingCount, outright: l.outright, nextAt: l.nextEventAt };
}

const signed = (x: number) => (x === 0 ? "PK" : x > 0 ? `+${x}` : `−${Math.abs(x)}`);

function sideOf(o: Offer | null, side: string, label: (pt: number) => string): BoardSide | null {
  const s = o?.sides.find((x) => x.side === side);
  if (!s?.best) return null;
  return { priceAmerican: s.best.priceAmerican, bookKey: s.best.bookKey, bookName: s.best.bookName, label: label(s.point), point: s.point, ev: s.ev, fairAmerican: s.fairAmerican };
}

/** The main game lines for one event's offers. */
export function boardLines(offers: PricedOffer[]) {
  const game = offers.filter((o) => o.period === "game");
  const ml = game.find((o) => o.kind === "ml") ?? null;
  const spread = mainOffer(game.filter((o) => o.kind === "spread"));
  const total = mainOffer(game.filter((o) => o.kind === "total"));
  const lines = {
    ml: { home: sideOf(ml, "home", () => ""), draw: sideOf(ml, "draw", () => ""), away: sideOf(ml, "away", () => "") },
    spread: { home: sideOf(spread, "home", signed), away: sideOf(spread, "away", signed) },
    total: { over: sideOf(total, "over", (p) => `O ${p}`), under: sideOf(total, "under", (p) => `U ${p}`) },
  };
  const edges = [lines.ml.home, lines.ml.draw, lines.ml.away, lines.spread.home, lines.spread.away, lines.total.over, lines.total.under]
    .map((s) => s?.ev ?? null)
    .filter((e): e is number => e !== null);
  return { ...lines, topEdge: edges.length ? Math.max(...edges) : null };
}

/** A sport's board: its leagues as chips, and the next week of games for the chosen league (or every league). */
export async function getSportBoard(sport: string, leagueSlug: string | null, now = new Date()) {
  const leagues = await prisma.league.findMany({ where: { sport, active: true }, orderBy: [{ rank: "asc" }, { nextEventAt: "asc" }] });
  const chips = leagues.map(chip);
  const games = chips.filter((c) => !c.outright);
  const futures = chips.filter((c) => c.outright);
  const selected = leagueSlug ? chips.find((c) => c.slug === leagueSlug) ?? null : null;
  const target = selected ? [selected] : games.filter((c) => c.upcoming > 0).slice(0, 12);

  const events = dropEspnTwins(
    await prisma.sportEvent.findMany({
      where: {
        leagueId: { in: target.filter((t) => !t.outright).map((t) => t.id) },
        status: { in: ["scheduled", "live"] },
        startsAt: { gte: new Date(now.getTime() - 3 * 3_600_000), lte: new Date(now.getTime() + BOARD_DAYS * 86_400_000) },
      },
      orderBy: { startsAt: "asc" },
      take: selected ? 300 : 600,
      include: { lines: true },
    })
  );
  const logos = await cachedLogos(sport, events.flatMap((e) => [e.home, e.away]));
  const ratingsBy = new Map<string, LeagueRatings>();
  for (const id of new Set(events.map((e) => e.leagueId))) ratingsBy.set(id, await leagueRatings(id, sport, now));

  const boards: LeagueBoard[] = target
    .map((league) => ({
      league,
      events: events
        .filter((e) => e.leagueId === league.id)
        .slice(0, selected ? 200 : 15)
        .map((e): BoardEvent => {
          const ratings = ratingsBy.get(e.leagueId) ?? null;
          const { offers } = priceEvent(e.lines, ratings, e.home, e.away, sport);
          return {
            id: e.id,
            startsAt: e.startsAt,
            status: e.status,
            home: e.home,
            away: e.away,
            homeLogo: logoSrc(sport, e.home, logos),
            awayLogo: logoSrc(sport, e.away, logos),
            homeScore: e.homeScore,
            awayScore: e.awayScore,
            ...boardLines(offers),
            markets: offers.length,
            archr: archrRead(ratings, e.home, e.away, sport),
          };
        }),
    }))
    .filter((b) => b.events.length > 0 || selected);

  return { sport: allSportOrDefault(sport), chips: games, futures, selected, boards };
}

export interface EventPage {
  id: string;
  sport: AllSport;
  league: LeagueChip & { sport: string };
  startsAt: Date;
  status: string;
  home: string;
  away: string;
  homeLogo: string;
  awayLogo: string;
  homeScore: number | null;
  awayScore: number | null;
  lastOddsAt: Date | null;
  offers: PricedOffer[];
  /** How much the model counted against the market here (0 = market only). */
  modelWeight: number;
  /** ARCHR's own prices from the model alone (the read before books post). */
  archr: ArchrRead | null;
  /** Win chances for the face-off: the main moneyline's ARCHR read. */
  probs: { home: number; draw: number; away: number } | null;
  ratings: {
    family: LeagueRatings["family"];
    results: number;
    avgScore: number;
    homeEdge: number;
    marginSd: number;
    home: { strength: number; games: number; form: TeamForm };
    away: { strength: number; games: number; form: TeamForm };
    /** Model-only win chances and expected score, before the market blend. */
    modelProbs: { home: number; draw: number; away: number } | null;
    expected: { home: number; away: number } | null;
  };
  h2h: { startsAt: Date; home: string; away: string; homeScore: number | null; awayScore: number | null }[];
  books: number;
}

export async function getEventPage(id: string, now = new Date()): Promise<EventPage | null> {
  const e = await prisma.sportEvent.findUnique({ where: { id }, include: { lines: true, league: true } });
  if (!e || e.league.outright) return null;
  const sport = allSportOrDefault(e.league.sport);
  const ratings = await leagueRatings(e.leagueId, sport.key, now);
  const { offers, weight } = priceEvent(e.lines, ratings, e.home, e.away, sport.key);
  const logos = await cachedLogos(sport.key, [e.home, e.away]);

  const ml = offers.find((o) => o.period === "game" && o.kind === "ml");
  const p = (side: string) => ml?.sides.find((s) => s.side === side)?.prob ?? null;
  const ph = p("home");
  const pa = p("away");
  const probs = ph !== null && pa !== null ? { home: ph, draw: p("draw") ?? 0, away: pa } : null;

  // The model's own read, for the breakdown: win chances (points: from the margin distribution) and expected score.
  const expected = ratings.expected(e.home, e.away);
  // Priced the way the moneyline is offered: 3-way (regulation) when books hang a draw, else 2-way with overtime.
  let modelProbs: { home: number; draw: number; away: number } | null = null;
  if (Math.min(ratings.games(e.home), ratings.games(e.away)) >= 3) {
    const threeWay = ml?.sides.some((s) => s.side === "draw") ?? false;
    const win = (side: string) => lineOutcomeFor(ratings, e.home, e.away, { kind: "ml", period: "game", side, team: "", point: 0, threeWay }, sport.key)?.win ?? null;
    const h = win("home");
    const a = win("away");
    if (h !== null && a !== null) modelProbs = { home: h, draw: threeWay ? (win("draw") ?? 0) : 0, away: a };
  }

  return {
    id: e.id,
    sport,
    league: { ...chip(e.league), sport: e.league.sport },
    startsAt: e.startsAt,
    status: e.status,
    home: e.home,
    away: e.away,
    homeLogo: logoSrc(sport.key, e.home, logos),
    awayLogo: logoSrc(sport.key, e.away, logos),
    homeScore: e.homeScore,
    awayScore: e.awayScore,
    lastOddsAt: e.lastOddsAt,
    offers,
    modelWeight: weight,
    archr: archrRead(ratings, e.home, e.away, sport.key),
    probs: probs ?? (() => {
      const a = archrRead(ratings, e.home, e.away, sport.key);
      return a ? a.probs : null;
    })(),
    ratings: {
      family: ratings.family,
      results: ratings.results,
      avgScore: ratings.avgScore,
      homeEdge: ratings.homeEdge,
      marginSd: ratings.marginSd,
      home: { strength: ratings.strength(e.home), games: ratings.games(e.home), form: ratings.form(e.home) },
      away: { strength: ratings.strength(e.away), games: ratings.games(e.away), form: ratings.form(e.away) },
      modelProbs,
      expected,
    },
    h2h: await headToHead(e.leagueId, e.home, e.away),
    books: new Set(e.lines.filter((l) => isBettableBook(l.bookKey)).map((l) => l.bookKey)).size,
  };
}

export interface FuturesRow {
  name: string;
  logo: string;
  best: { priceAmerican: number; bookKey: string; bookName: string } | null;
  /** No-vig chance, averaged over books (each book's prices normalized to 100%). */
  fair: number | null;
  fairAmerican: number | null;
  ev: number | null;
  books: number;
}

/** A futures board: every contender's best price and the books' de-vigged chance. */
export async function getFuturesBoard(leagueId: string) {
  const league = await prisma.league.findUnique({ where: { id: leagueId } });
  if (!league) return null;
  const event = await prisma.sportEvent.findFirst({ where: { leagueId }, orderBy: { lastOddsAt: "desc" }, include: { lines: { where: { market: "outright" } } } });
  const lines = event?.lines ?? [];
  // Each book's field de-vigged on its own (its implied chances scaled to sum to 1).
  const byBook = new Map<string, { side: string; p: number }[]>();
  for (const l of lines) byBook.set(l.bookKey, [...(byBook.get(l.bookKey) ?? []), { side: l.side, p: americanToImpliedProbability(l.priceAmerican) }]);
  const fairSum = new Map<string, { sum: number; n: number }>();
  for (const prices of byBook.values()) {
    const z = prices.reduce((s, x) => s + x.p, 0);
    if (z <= 0) continue;
    for (const x of prices) {
      const f = fairSum.get(x.side) ?? { sum: 0, n: 0 };
      fairSum.set(x.side, { sum: f.sum + x.p / z, n: f.n + 1 });
    }
  }
  const names = [...new Set(lines.map((l) => l.side))];
  const logos = await cachedLogos(league.sport, names);
  const rows: FuturesRow[] = names.map((name) => {
    const mine = lines.filter((l) => l.side === name);
    const best = mine.filter((l) => isBettableBook(l.bookKey)).sort((a, b) => b.priceAmerican - a.priceAmerican)[0];
    const f = fairSum.get(name);
    // A book's field share counts only when at least two books price the name.
    const fair = f && f.n >= 2 ? f.sum / f.n : null;
    const dec = best ? (best.priceAmerican > 0 ? 1 + best.priceAmerican / 100 : 1 + 100 / -best.priceAmerican) : null;
    return {
      name,
      logo: logoSrc(league.sport, name, logos),
      best: best ? { priceAmerican: best.priceAmerican, bookKey: best.bookKey, bookName: BOOK_NAMES[best.bookKey] ?? best.bookKey } : null,
      fair,
      fairAmerican: fair ? Math.round(decimalToAmerican(1 / fair)) : null,
      ev: fair && dec ? fair * dec - 1 : null,
      books: new Set(mine.map((l) => l.bookKey)).size,
    };
  });
  rows.sort((a, b) => (b.fair ?? 0) - (a.fair ?? 0) || (a.best?.priceAmerican ?? 1e9) - (b.best?.priceAmerican ?? 1e9));
  return { league: chip(league), sport: allSportOrDefault(league.sport), updatedAt: event?.lastOddsAt ?? null, rows };
}

/**
 * The home page's every-sport section: the next big games around the world —
 * the top-ranked leagues with a game in the next two days, a few games each.
 */
export async function getHomeAllSports(now = new Date(), leagues = 4, perLeague = 3): Promise<(LeagueBoard & { sport: AllSport; threeWay: boolean })[]> {
  const soon = await prisma.league.findMany({
    where: { active: true, outright: false, nextEventAt: { gte: new Date(now.getTime() - 3 * 3_600_000), lte: new Date(now.getTime() + 48 * 3_600_000) } },
    orderBy: [{ rank: "asc" }, { nextEventAt: "asc" }],
    take: 30,
  });
  // One league per sport first, so the section spans sports rather than four soccer leagues.
  const picked: typeof soon = [];
  for (const l of soon) if (!picked.some((p) => p.sport === l.sport)) picked.push(l);
  for (const l of soon) if (picked.length < leagues && !picked.includes(l)) picked.push(l);
  const out: (LeagueBoard & { sport: AllSport; threeWay: boolean })[] = [];
  for (const l of picked.slice(0, leagues)) {
    const board = await getSportBoard(l.sport, l.id.slice(l.sport.length + 1), now);
    const b = board.boards[0];
    if (!b || b.events.length === 0) continue;
    out.push({ league: b.league, events: b.events.slice(0, perLeague), sport: board.sport, threeWay: board.sport.family === "goals" && l.sport !== "hockey" });
  }
  return out;
}
