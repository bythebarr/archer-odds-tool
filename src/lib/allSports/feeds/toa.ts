/**
 * The Odds API (and ParlayAPI, its URL-compatible twin) as an all-sports feed.
 *
 * Cost: the league list and events list are free; odds bill per market per
 * region (ten named books = one region), whatever the event count; scores
 * with history cost 2. So one league's main lines cost 3 credits, a futures
 * board 1 — see docs/architecture/ALL-SPORTS.md for the monthly budget.
 */
import {
  fetchOdds,
  fetchScores,
  fetchSportEvents,
  fetchSportsList,
  type OddsApiEvent,
  type OddsApiMarketKey,
  type OddsApiScore,
} from "@/lib/odds/oddsApiClient";
import type { AllSportsFeed, FeedEvent, FeedLeague, FeedLine } from "../feed";
import { fromToaKey } from "../sports";

const GAME_MARKETS: OddsApiMarketKey[] = ["h2h", "spreads", "totals"];
/** Sports where books only hang the winner: asking for spreads/totals there wastes credits. */
const WINNER_ONLY = /^(boxing|golf)_|_winner$/;

function sideOf(name: string, event: { home_team: string | null; away_team: string | null }): string | null {
  if (name === event.home_team) return "home";
  if (name === event.away_team) return "away";
  if (/^(draw|tie)$/i.test(name)) return "draw";
  if (/^over$/i.test(name)) return "over";
  if (/^under$/i.test(name)) return "under";
  return null;
}

/** One event's bookmakers → lines. Unknown outcomes and priceless rows are dropped. */
export function toaEventLines(event: OddsApiEvent, outright: boolean): FeedLine[] {
  const out: FeedLine[] = [];
  for (const book of event.bookmakers ?? []) {
    for (const market of book.markets ?? []) {
      const kind = market.key === "h2h" ? "ml" : market.key === "spreads" ? "spread" : market.key === "totals" ? "total" : market.key === "outrights" ? "outright" : null;
      if (!kind) continue;
      for (const o of market.outcomes ?? []) {
        if (o.price === null || o.price === undefined || !Number.isFinite(o.price)) continue;
        const side = kind === "outright" || outright ? o.name : sideOf(o.name, event);
        if (!side) continue;
        if ((kind === "spread" || kind === "total") && (o.point === undefined || o.point === null)) continue;
        out.push({
          eventId: event.id,
          bookKey: book.key,
          market: kind === "ml" && outright ? "outright" : kind,
          period: "game",
          side,
          point: kind === "spread" || kind === "total" ? Number(o.point) : 0,
          priceAmerican: Math.round(o.price),
        });
      }
    }
  }
  return out;
}

function stubToEvent(e: { id: string; sport_key: string; commence_time: string; home_team: string | null; away_team: string | null }, title: string): FeedEvent {
  return {
    id: e.id,
    providerKey: e.sport_key,
    startsAt: new Date(e.commence_time),
    home: e.home_team ?? title,
    away: e.away_team ?? "",
    status: "scheduled",
  };
}

export function toaScoreToEvent(s: OddsApiScore, title: string): FeedEvent {
  const score = (team: string | null) => {
    const v = s.scores?.find((x) => x.name === team)?.score;
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    ...stubToEvent(s, title),
    status: s.completed ? "final" : s.scores ? "live" : "scheduled",
    homeScore: score(s.home_team),
    awayScore: score(s.away_team),
  };
}

export const toaFeed: AllSportsFeed = {
  id: "toa",

  async listLeagues() {
    const sports = await fetchSportsList();
    const out: FeedLeague[] = [];
    for (const s of sports) {
      if (!s.active) continue;
      const ref = fromToaKey(s.key);
      if (!ref) continue;
      out.push({ providerKey: s.key, ref, title: s.title, region: null, outright: s.has_outrights });
    }
    return out;
  },

  async listEvents(leagues) {
    const out = new Map<string, FeedEvent[]>();
    for (const l of leagues) {
      try {
        out.set(l.providerKey, (await fetchSportEvents(l.providerKey)).map((e) => stubToEvent(e, l.title)));
      } catch {
        out.set(l.providerKey, []);
      }
    }
    return out;
  },

  async fetchOdds(league) {
    const markets: OddsApiMarketKey[] = league.outright ? ["outrights"] : WINNER_ONLY.test(league.providerKey) ? ["h2h"] : GAME_MARKETS;
    const res = await fetchOdds(league.providerKey, markets, ["us", "us2"]);
    return {
      events: res.events.map((e) => stubToEvent(e, league.title)),
      lines: res.events.flatMap((e) => toaEventLines(e, league.outright)),
      cost: res.creditsUsed ?? markets.length,
      remaining: res.creditsRemaining,
    };
  },

  async fetchResults(league) {
    if (league.outright) return { events: [], cost: 0 };
    const res = await fetchScores(league.providerKey, 3);
    return { events: res.scores.map((s) => toaScoreToEvent(s, league.title)), cost: res.creditsUsed ?? 2 };
  },
};
