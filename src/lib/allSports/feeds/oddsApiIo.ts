/**
 * odds-api.io as an all-sports feed: 34 sports — table tennis, darts, esports,
 * volleyball, snooker, padel and the rest The Odds API doesn't carry — from
 * 400+ books, US books included. Billed per request (5,000 an hour on paid
 * plans), not per market, so depth is cheap; odds come ten events a request.
 *
 * Key: ODDS_API_IO_KEY. Books: ODDS_API_IO_BOOKMAKERS, comma-separated names as
 * odds-api.io spells them (the plan caps how many; the defaults are below).
 * Docs: https://docs.odds-api.io/llms-full.txt
 */
import { decimalToAmericanPrice, type AllSportsFeed, type FeedEvent, type FeedEventStatus, type FeedLeague, type FeedLine } from "../feed";
import { fromOddsApiIo } from "../sports";

const BASE_URL = "https://api.odds-api.io/v3";

/** odds-api.io's book names → our book keys (bookAllowlist.ts); theScore Bet is ESPN BET's new name. */
export const ODDS_API_IO_BOOKS: Record<string, string> = {
  DraftKings: "draftkings",
  FanDuel: "fanduel",
  BetMGM: "betmgm",
  Caesars: "caesars",
  Fanatics: "fanatics",
  BetRivers: "betrivers",
  "Hard Rock": "hardrock",
  "bet365 NJ": "bet365",
  Bet365: "bet365",
  "theScore Bet": "espnbet",
  BetParx: "parx",
  Circa: "circa",
  Pinnacle: "pinnacle",
  Bovada: "bovada",
  "BetOnline.ag": "betonlineag",
  NoVig: "novig",
  ProphetX: "prophetx",
  Kalshi: "kalshi",
  Polymarket: "polymarket",
};

const DEFAULT_BOOKS = "DraftKings,FanDuel,BetMGM,Caesars,Fanatics,BetRivers,theScore Bet,Hard Rock,bet365 NJ,Circa";

export function oddsApiIoBooks(): string[] {
  return (process.env.ODDS_API_IO_BOOKMAKERS ?? DEFAULT_BOOKS).split(",").map((b) => b.trim()).filter(Boolean);
}

/** Every sport odds-api.io lists. */
export const ODDS_API_IO_SPORTS = [
  "football", "basketball", "tennis", "baseball", "american-football", "ice-hockey", "esports", "darts",
  "mixed-martial-arts", "boxing", "handball", "volleyball", "snooker", "table-tennis", "rugby", "cricket",
  "water-polo", "futsal", "beach-volleyball", "aussie-rules", "floorball", "squash", "beach-soccer",
  "lacrosse", "curling", "padel", "bandy", "gaelic-football", "beach-handball", "athletics", "badminton",
  "cross-country", "golf", "cycling",
];

/** Markets we ask for; a sport that doesn't price one simply leaves it out. */
const MARKETS = ["ML", "Spread", "Totals", "Both Teams To Score", "Draw No Bet", "ML HT", "Spread HT", "Totals HT", "Team Total Home", "Team Total Away"];

const MARKET_MAP: Record<string, { market: string; period: string }> = {
  ML: { market: "ml", period: "game" },
  Spread: { market: "spread", period: "game" },
  Totals: { market: "total", period: "game" },
  "Both Teams To Score": { market: "btts", period: "game" },
  "Draw No Bet": { market: "dnb", period: "game" },
  "ML HT": { market: "ml", period: "h1" },
  "Spread HT": { market: "spread", period: "h1" },
  "Totals HT": { market: "total", period: "h1" },
  "Team Total Home": { market: "team_total_home", period: "game" },
  "Team Total Away": { market: "team_total_away", period: "game" },
};

interface IoEvent {
  id: number;
  home: string;
  away: string;
  homeId?: number;
  awayId?: number;
  date: string;
  status: string;
  sport: { slug: string };
  league: { name: string; slug: string };
  scores?: { home?: number; away?: number; periods?: Record<string, { home: number; away: number }> } | null;
}

interface IoOddsRow {
  hdp?: number;
  home?: string;
  away?: string;
  draw?: string;
  over?: string;
  under?: string;
  yes?: string;
  no?: string;
}

interface IoEventOdds extends IoEvent {
  bookmakers: Record<string, { name: string; odds: IoOddsRow[] }[]>;
}

let lastRemaining: number | null = null;

async function get<T>(path: string, params: Record<string, string>): Promise<T> {
  const key = process.env.ODDS_API_IO_KEY;
  if (!key) throw new Error("ODDS_API_IO_KEY is not set");
  const url = new URL(`${BASE_URL}${path}`);
  url.searchParams.set("apiKey", key);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  const remaining = Number(res.headers.get("x-ratelimit-remaining"));
  if (Number.isFinite(remaining)) lastRemaining = remaining;
  if (!res.ok) throw new Error(`odds-api.io ${path} failed: ${res.status} — ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

function status(s: string): FeedEventStatus {
  return s === "live" ? "live" : s === "settled" ? "final" : s === "cancelled" ? "cancelled" : "scheduled";
}

export function ioEventToFeed(e: IoEvent): FeedEvent {
  return {
    id: String(e.id),
    providerKey: `${e.sport.slug}|${e.league.slug}`,
    startsAt: new Date(e.date),
    home: e.home,
    away: e.away,
    homeRef: e.homeId !== undefined ? String(e.homeId) : null,
    awayRef: e.awayId !== undefined ? String(e.awayId) : null,
    status: status(e.status),
    homeScore: e.scores?.home ?? null,
    awayScore: e.scores?.away ?? null,
    periods: e.scores?.periods ?? null,
  };
}

/** One event's odds → lines. Decimal strings become American; unknown books and markets are dropped. */
export function ioOddsToLines(e: IoEventOdds): FeedLine[] {
  const out: FeedLine[] = [];
  const eventId = String(e.id);
  for (const [bookName, markets] of Object.entries(e.bookmakers ?? {})) {
    const bookKey = ODDS_API_IO_BOOKS[bookName];
    if (!bookKey) continue;
    for (const m of markets) {
      const meta = MARKET_MAP[m.name];
      if (!meta) continue;
      for (const row of m.odds ?? []) {
        const push = (side: string, price: string | undefined, point: number) => {
          const american = price === undefined ? null : decimalToAmericanPrice(Number(price));
          if (american !== null) out.push({ eventId, bookKey, market: meta.market, period: meta.period, side, point, priceAmerican: american });
        };
        if (meta.market === "ml" || meta.market === "dnb") {
          push("home", row.home, 0);
          push("away", row.away, 0);
          if (meta.market === "ml") push("draw", row.draw, 0);
        } else if (meta.market === "spread") {
          if (row.hdp === undefined) continue;
          push("home", row.home, row.hdp);
          push("away", row.away, -row.hdp);
        } else if (meta.market === "btts") {
          push("yes", row.yes, 0);
          push("no", row.no, 0);
        } else {
          if (row.hdp === undefined) continue;
          push("over", row.over, row.hdp);
          push("under", row.under, row.hdp);
        }
      }
    }
  }
  return out;
}

export const oddsApiIoFeed: AllSportsFeed = {
  id: "oddsapiio",

  async listLeagues() {
    const out: FeedLeague[] = [];
    for (const sport of ODDS_API_IO_SPORTS) {
      let leagues: { name: string; slug: string; eventsCount?: number }[] = [];
      try {
        leagues = await get("/leagues", { sport });
      } catch {
        continue;
      }
      for (const l of leagues) {
        if (l.eventsCount === 0) continue;
        const ref = fromOddsApiIo(sport, l.slug, l.name);
        if (!ref) continue;
        // "England - Premier League" → region England, title Premier League.
        const dash = l.name.indexOf(" - ");
        out.push({
          providerKey: `${sport}|${l.slug}`,
          ref,
          title: dash > 0 ? l.name.slice(dash + 3) : l.name,
          region: dash > 0 ? l.name.slice(0, dash) : null,
          outright: false,
        });
      }
    }
    return out;
  },

  async listEvents(leagues) {
    const wanted = new Set(leagues.map((l) => l.providerKey));
    const out = new Map<string, FeedEvent[]>(leagues.map((l) => [l.providerKey, []]));
    const sports = [...new Set(leagues.map((l) => l.providerKey.split("|")[0]!))];
    for (const sport of sports) {
      let events: IoEvent[] = [];
      try {
        events = await get("/events", { sport, status: "pending,live", limit: "5000" });
      } catch {
        continue;
      }
      for (const e of events) {
        const ev = ioEventToFeed(e);
        if (wanted.has(ev.providerKey)) out.get(ev.providerKey)!.push(ev);
      }
    }
    return out;
  },

  async fetchOdds(_league, eventIds) {
    const books = oddsApiIoBooks().join(",");
    const events: FeedEvent[] = [];
    const lines: FeedLine[] = [];
    let cost = 0;
    for (let i = 0; i < eventIds.length; i += 10) {
      const batch = eventIds.slice(i, i + 10);
      const res = await get<IoEventOdds[]>("/odds/multi", { eventIds: batch.join(","), bookmakers: books, markets: MARKETS.join(",") });
      cost++;
      for (const e of res) {
        events.push(ioEventToFeed(e));
        lines.push(...ioOddsToLines(e));
      }
    }
    return { events, lines, cost, remaining: lastRemaining };
  },

  async fetchResults(league) {
    const [sport, slug] = league.providerKey.split("|");
    const from = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const events = await get<IoEvent[]>("/events", { sport: sport!, league: slug!, status: "settled", from, to: new Date().toISOString() });
    return { events: events.map(ioEventToFeed), cost: 1 };
  },
};
