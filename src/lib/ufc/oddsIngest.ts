import { prisma } from "@/lib/prisma";
import { fetchUfcOdds, type OddsApiBookmaker, type OddsApiEvent } from "@/lib/odds/oddsApiClient";
import { ALLOWED_BOOK_KEYS } from "@/lib/odds/bookAllowlist";

/**
 * UFC moneyline odds ingest: pull The Odds API's MMA h2h feed, match each
 * event to one of our upcoming Cito bouts by fighter-name pair, and upsert a
 * UfcBoutOdds row per allowlisted book × corner. Mirrors the MLB
 * fetch→match→store split (odds/ingest.ts + odds/storeOdds.ts), but the join
 * key is a normalized fighter-name pair rather than an event-id + team names,
 * since Cito and The Odds API share no id space.
 *
 * The MMA feed mixes promotions (UFC + Oktagon/PFL/etc.); non-UFC events
 * simply won't match any ingested bout and are dropped. A useful byproduct:
 * because the odds feed reflects the ACTUAL announced card, a bout whose Cito
 * fighters are wrong (see the Osbourne/Costa case) won't match here — a signal
 * worth surfacing later.
 */

const ALLOWED = new Set<string>(ALLOWED_BOOK_KEYS);

/** Lowercase, strip diacritics + punctuation, collapse whitespace — so "Ode' Osbourne" and "Patrik Šebek" match across the two feeds' spellings. */
function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Sorted, normalized "fighterA|fighterB" key — order-independent so red/blue vs home/away corner assignment doesn't matter for matching. */
function pairKey(nameOne: string, nameTwo: string): string {
  return [normalizeName(nameOne), normalizeName(nameTwo)].sort().join("|");
}

interface BoutForMatch {
  id: string;
  oddsApiEventId: string | null;
  redName: string;
  blueName: string;
}

/** Which corner an odds outcome (a fighter name) belongs to, or null if it matches neither corner. */
function cornerForOutcome(outcomeName: string, bout: BoutForMatch): "red" | "blue" | null {
  const n = normalizeName(outcomeName);
  if (n === normalizeName(bout.redName)) return "red";
  if (n === normalizeName(bout.blueName)) return "blue";
  return null;
}

export interface UfcOddsIngestSummary {
  eventsFetched: number;
  boutsMatched: number;
  rowsWritten: number;
  creditsUsed: number | null;
  creditsRemaining: number | null;
}

/** Upsert one bout's moneyline rows from its matched odds event's bookmakers. Returns rows written. */
async function storeUfcBoutOdds(
  bout: BoutForMatch,
  bookmakers: OddsApiBookmaker[],
  polledAt: Date
): Promise<number> {
  let written = 0;

  for (const bookmaker of bookmakers) {
    if (!ALLOWED.has(bookmaker.key)) continue;

    const h2h = bookmaker.markets.find((m) => m.key === "h2h");
    if (!h2h) continue;

    // Upsert the book registry row on the fly, exactly like storeBookmakerOdds
    // — the MLB poller may already have created it; don't clobber its region.
    await prisma.sportsbook.upsert({
      where: { key: bookmaker.key },
      create: { key: bookmaker.key, displayName: bookmaker.title, region: "us" },
      update: { displayName: bookmaker.title },
    });

    const sourceLastUpdate = new Date(h2h.last_update ?? bookmaker.last_update ?? polledAt);

    for (const outcome of h2h.outcomes) {
      const corner = cornerForOutcome(outcome.name, bout);
      if (!corner) continue;

      await prisma.ufcBoutOdds.upsert({
        where: { boutId_bookKey_corner: { boutId: bout.id, bookKey: bookmaker.key, corner } },
        create: {
          boutId: bout.id,
          bookKey: bookmaker.key,
          corner,
          priceAmerican: Math.round(outcome.price),
          polledAt,
          sourceLastUpdate,
        },
        update: {
          priceAmerican: Math.round(outcome.price),
          polledAt,
          sourceLastUpdate,
        },
      });
      written++;
    }
  }

  return written;
}

/** Match one odds event to a bout: prefer the cached event-id link, else the normalized fighter-name pair. */
function matchBout(
  event: OddsApiEvent,
  byEventId: Map<string, BoutForMatch>,
  byPair: Map<string, BoutForMatch>
): BoutForMatch | null {
  return byEventId.get(event.id) ?? byPair.get(pairKey(event.home_team, event.away_team)) ?? null;
}

export async function pollAndStoreUfcOdds(): Promise<UfcOddsIngestSummary> {
  const { events, creditsUsed, creditsRemaining } = await fetchUfcOdds();

  // Only not-yet-fought bouts can have live odds; matches the listUpcoming filter.
  const bouts = await prisma.ufcBout.findMany({
    where: { status: { not: "completed" } },
    select: {
      id: true,
      oddsApiEventId: true,
      redCornerFighter: { select: { fullName: true } },
      blueCornerFighter: { select: { fullName: true } },
    },
  });

  const byPair = new Map<string, BoutForMatch>();
  const byEventId = new Map<string, BoutForMatch>();
  for (const b of bouts) {
    const bm: BoutForMatch = {
      id: b.id,
      oddsApiEventId: b.oddsApiEventId,
      redName: b.redCornerFighter.fullName,
      blueName: b.blueCornerFighter.fullName,
    };
    byPair.set(pairKey(bm.redName, bm.blueName), bm);
    if (bm.oddsApiEventId) byEventId.set(bm.oddsApiEventId, bm);
  }

  const polledAt = new Date();
  let boutsMatched = 0;
  let rowsWritten = 0;

  for (const event of events) {
    const bout = matchBout(event, byEventId, byPair);
    if (!bout) continue;

    // Cache the event-id link on first match so later polls skip the name join.
    // Guarded so a duplicate event id (shouldn't happen) can't abort the run.
    if (!bout.oddsApiEventId) {
      try {
        await prisma.ufcBout.update({ where: { id: bout.id }, data: { oddsApiEventId: event.id } });
        bout.oddsApiEventId = event.id;
      } catch {
        // Non-fatal: fall through to storing odds via the name match this run.
      }
    }

    boutsMatched++;
    rowsWritten += await storeUfcBoutOdds(bout, event.bookmakers, polledAt);
  }

  return { eventsFetched: events.length, boutsMatched, rowsWritten, creditsUsed, creditsRemaining };
}
