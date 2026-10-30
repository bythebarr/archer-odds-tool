/**
 * Book prices from EventPropLine (the ESPN prop feed, every sport) in the
 * shape the props sheets' book tables read: per player, per stat, every
 * bettable book's Over/Under at each number. Full-game priced lines only; a
 * Yes prop reads as Over 0.5, as the typed tables store it.
 */
import { prisma } from "@/lib/prisma";
import type { PropQuote } from "@/lib/nba/propsMath";

const BOOK_NAMES: Record<string, string> = { draftkings: "DraftKings", fanduel: "FanDuel", betmgm: "BetMGM", caesars: "Caesars", espnbet: "theScore Bet" };

export type BookQuotesByPlayer = Record<string, Record<string, PropQuote[]>>;

/** `statByKey` maps the feed's stat words (espnProps.statKeyOf) to the board's stat keys; unmapped markets are left out. */
export async function eventPropQuotes(eventRefs: string[], statByKey: Record<string, string>): Promise<BookQuotesByPlayer> {
  if (!eventRefs.length) return {};
  const rows = await prisma.eventPropLine.findMany({
    where: { eventRef: { in: eventRefs }, period: "game", priceAmerican: { not: null }, statKey: { in: Object.keys(statByKey) } },
    select: { athleteId: true, statKey: true, side: true, point: true, bookKey: true, priceAmerican: true },
  });
  const out: BookQuotesByPlayer = {};
  for (const r of rows) {
    const stat = statByKey[r.statKey];
    const side = r.side === "under" ? "under" : "over";
    const point = r.side === "yes" ? 0.5 : r.point;
    const list = ((out[r.athleteId] ??= {})[stat] ??= []);
    if (list.some((q) => q.bookKey === r.bookKey && q.side === side && q.point === point)) continue;
    list.push({ bookKey: r.bookKey, bookName: BOOK_NAMES[r.bookKey] ?? r.bookKey, side, point, priceAmerican: r.priceAmerican! });
  }
  return out;
}

/** A number a book has posted, priced or not yet: what a hit-rate search needs. */
export interface PostedLine {
  side: "over" | "under";
  point: number;
}

/**
 * Every full-game number posted on these events (ESPN prop feed), priced or
 * not, per ESPN athlete id and board stat. DraftKings hangs the week's NFL
 * numbers days before ESPN carries their prices; the parlay finder only needs
 * the numbers.
 */
export async function eventPropPostedLines(eventRefs: string[], statByKey: Record<string, string>): Promise<Record<string, Record<string, PostedLine[]>>> {
  if (!eventRefs.length) return {};
  const rows = await prisma.eventPropLine.findMany({
    where: { eventRef: { in: eventRefs }, period: "game", statKey: { in: Object.keys(statByKey) } },
    select: { athleteId: true, statKey: true, side: true, point: true },
    distinct: ["athleteId", "statKey", "side", "point"],
  });
  const out: Record<string, Record<string, PostedLine[]>> = {};
  for (const r of rows) {
    const side = r.side === "under" ? "under" : "over";
    const point = r.side === "yes" ? 0.5 : r.point;
    const list = ((out[r.athleteId] ??= {})[statByKey[r.statKey]] ??= []);
    if (!list.some((l) => l.side === side && l.point === point)) list.push({ side, point });
  }
  return out;
}
