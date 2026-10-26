/**
 * Every game-line market beyond the main three, for NBA and NFL: alternate
 * spreads and totals, team totals (and their alternates), and halves and
 * quarters (moneyline, spread, total, team total). The Odds API serves these
 * only per event, billed per market returned × region, so the poll covers
 * games starting within each league's lookahead.
 *
 * A market key the provider doesn't recognize fails the whole request
 * (INVALID_MARKET), so keys are requested in small batches. A rejected batch
 * is split until the bad key is found, and that key is skipped from then on
 * (reported in the summary). One unknown key never costs the rest.
 */
import { prisma } from "@/lib/prisma";
import { fetchEventPlayerProps, type OddsApiEvent } from "@/lib/odds/oddsApiClient";
import { ALLOWED_BOOK_KEYS } from "@/lib/odds/bookAllowlist";
import type { TeamLeague } from "./league";

import type { MarketKind, Period } from "@/lib/gameModel/markets";

const PERIODS: Period[] = ["h1", "h2", "q1", "q2", "q3", "q4"];

/** Every extra market we request for a team league, in priority order. */
export const EXTRA_MARKET_KEYS: string[] = [
  "alternate_spreads",
  "alternate_totals",
  "team_totals",
  "alternate_team_totals",
  ...PERIODS.flatMap((p) => [`h2h_${p}`, `spreads_${p}`, `totals_${p}`]),
  "team_totals_h1",
  "team_totals_q1",
  "alternate_spreads_h1",
  "alternate_totals_h1",
  "alternate_team_totals_h1",
  "alternate_spreads_q1",
  "alternate_totals_q1",
];

/** What a provider market key means: its period and kind. Null for keys we don't model. */
export function parseMarketKey(key: string): { period: Period; kind: MarketKind } | null {
  const m = /^(alternate_)?(h2h|spreads|totals|team_totals)(?:_(h1|h2|q1|q2|q3|q4))?$/.exec(key);
  if (!m) return null;
  const kind: MarketKind = m[2] === "h2h" ? "ml" : m[2] === "spreads" ? "spread" : m[2] === "totals" ? "total" : "teamTotal";
  return { period: (m[3] as Period | undefined) ?? "game", kind };
}

export interface MarketLineRow {
  bookKey: string;
  bookTitle: string;
  marketKey: string;
  period: Period;
  kind: MarketKind;
  side: "home" | "away" | "over" | "under" | "draw";
  team: "" | "home" | "away";
  point: number;
  priceAmerican: number;
}

const ALLOWED = new Set<string>(ALLOWED_BOOK_KEYS);

/** One event's bookmakers → rows, resolving team names to home/away. Unknown outcomes are dropped. */
export function eventToMarketRows(event: OddsApiEvent): MarketLineRow[] {
  const out: MarketLineRow[] = [];
  const sideOf = (name: string): "home" | "away" | null => (name === event.home_team ? "home" : name === event.away_team ? "away" : null);
  for (const book of event.bookmakers ?? []) {
    if (!ALLOWED.has(book.key)) continue;
    for (const market of book.markets ?? []) {
      const meta = parseMarketKey(market.key);
      if (!meta) continue;
      for (const o of market.outcomes ?? []) {
        const price = o.price;
        if (price === null || price === undefined || !Number.isFinite(price)) continue;
        const name = o.name ?? "";
        const base = { bookKey: book.key, bookTitle: book.title, marketKey: market.key, period: meta.period, kind: meta.kind, priceAmerican: price };
        if (meta.kind === "ml" || meta.kind === "spread") {
          const side = /^draw$|^tie$/i.test(name) ? "draw" : sideOf(name);
          if (!side || (meta.kind === "spread" && (o.point === undefined || o.point === null))) continue;
          out.push({ ...base, side, team: "", point: meta.kind === "spread" ? Number(o.point) : 0 });
        } else {
          const side = /^over$/i.test(name) ? "over" : /^under$/i.test(name) ? "under" : null;
          if (!side || o.point === undefined || o.point === null) continue;
          if (meta.kind === "teamTotal") {
            const team = sideOf(o.description ?? "");
            if (!team) continue;
            out.push({ ...base, side, team, point: Number(o.point) });
          } else {
            out.push({ ...base, side, team: "", point: Number(o.point) });
          }
        }
      }
    }
  }
  return out;
}

/** Keys the provider rejected this process — skipped on later polls. */
const rejectedKeys = new Set<string>();
const BATCH = 8;
const REGIONS = ["us", "us2"];

function invalidMarket(error: unknown): boolean {
  return /INVALID_MARKET|422/i.test(error instanceof Error ? error.message : String(error));
}

/** Fetches `keys` for one event, splitting rejected batches until each bad key is isolated. */
async function fetchKeys(
  league: TeamLeague,
  eventId: string,
  keys: string[],
  acc: { events: OddsApiEvent[]; credits: number; remaining: number | null; rejected: string[] }
): Promise<void> {
  if (keys.length === 0) return;
  try {
    const res = await fetchEventPlayerProps(eventId, keys, REGIONS, league.oddsSportKey);
    acc.events.push(res.event);
    acc.credits += res.creditsUsed ?? 0;
    acc.remaining = res.creditsRemaining;
  } catch (error) {
    if (!invalidMarket(error)) throw error;
    if (keys.length === 1) {
      rejectedKeys.add(keys[0]);
      acc.rejected.push(keys[0]);
      return;
    }
    const mid = Math.ceil(keys.length / 2);
    await fetchKeys(league, eventId, keys.slice(0, mid), acc);
    await fetchKeys(league, eventId, keys.slice(mid), acc);
  }
}

export interface ExtraMarketsSummary {
  gamesConsidered: number;
  gamesStored: number;
  linesStored: number;
  rejectedKeys: string[];
  failures: string[];
  creditsUsed: number;
  creditsRemaining: number | null;
}

/** Refreshes GameMarketLine for every game starting within `lookaheadHours`. */
export async function pollExtraMarkets(league: TeamLeague, lookaheadHours: number, now: Date = new Date()): Promise<ExtraMarketsSummary> {
  const games = await prisma.game.findMany({
    where: {
      sport: league.sport,
      status: "scheduled",
      oddsApiEventId: { not: null },
      scheduledStartUtc: { gte: now, lte: new Date(now.getTime() + lookaheadHours * 3_600_000) },
    },
    select: { id: true, oddsApiEventId: true },
  });
  const summary: ExtraMarketsSummary = { gamesConsidered: games.length, gamesStored: 0, linesStored: 0, rejectedKeys: [], failures: [], creditsUsed: 0, creditsRemaining: null };
  const keys = EXTRA_MARKET_KEYS.filter((k) => !rejectedKeys.has(k));

  for (const game of games) {
    const acc = { events: [] as OddsApiEvent[], credits: 0, remaining: null as number | null, rejected: [] as string[] };
    try {
      for (let i = 0; i < keys.length; i += BATCH) await fetchKeys(league, game.oddsApiEventId!, keys.slice(i, i + BATCH), acc);
    } catch (error) {
      summary.failures.push(`${game.id}: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
      continue;
    }
    summary.creditsUsed += acc.credits;
    summary.creditsRemaining = acc.remaining ?? summary.creditsRemaining;
    summary.rejectedKeys.push(...acc.rejected.filter((k) => !summary.rejectedKeys.includes(k)));

    // Last write wins per unique key (a book can repeat a line across batches).
    const unique = new Map<string, MarketLineRow>();
    for (const e of acc.events) for (const r of eventToMarketRows(e)) unique.set(`${r.bookKey}|${r.marketKey}|${r.side}|${r.team}|${r.point}`, r);
    if (unique.size === 0) continue;
    const rows = [...unique.values()];
    const polledAt = new Date();
    const books = new Map(rows.map((r) => [r.bookKey, r.bookTitle]));
    for (const [key, title] of books) {
      await prisma.sportsbook.upsert({ where: { key }, create: { key, displayName: title, region: "us" }, update: {} });
    }
    await prisma.$transaction([
      prisma.gameMarketLine.deleteMany({ where: { gameId: game.id } }),
      prisma.gameMarketLine.createMany({
        data: rows.map((r) => ({
          gameId: game.id,
          bookKey: r.bookKey,
          marketKey: r.marketKey,
          period: r.period,
          kind: r.kind,
          side: r.side,
          team: r.team,
          point: r.point,
          priceAmerican: r.priceAmerican,
          polledAt,
        })),
      }),
    ]);
    summary.gamesStored++;
    summary.linesStored += rows.length;
  }
  return summary;
}
