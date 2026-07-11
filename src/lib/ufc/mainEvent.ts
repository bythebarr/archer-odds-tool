/**
 * Identify a UFC event's MAIN EVENT bout — needed to schedule it for 5 rounds
 * (see scheduledRoundsForBout). Two signals, in priority order:
 *
 *   1. boutOrder — authoritative when present: the lowest boutOrder in the event
 *      is the headliner (main card, position 1). Set on cards ingested after the
 *      field was added (all upcoming/confirmed bouts have it).
 *   2. Event title — the fallback for the historical roster, where boutOrder was
 *      never backfilled. Every UFC event is titled "…: A vs. B" naming exactly
 *      the headline pairing, so the main event is the bout whose BOTH fighters
 *      appear in the title. Validated across 755 historical (no-boutOrder) events:
 *      77% resolve to exactly one bout, ZERO ambiguous. The ~23% that don't are
 *      old slogan/nickname titles ("UFC 101: Declaration", "Dos Anjos vs. Cowboy")
 *      where the resultRound backstop still recovers any fight that went to R4/R5.
 *
 * Diacritic- and name-order-insensitive: matches on any name token ≥3 chars, so
 * "Procházka" matches title "Prochazka" and "Song Yadong" / "Zhang Mingyang"
 * (family name first) match their headline surnames.
 */

/** Lowercase, strip diacritics, reduce punctuation to spaces. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ");
}

/** Common title/nickname filler that would create noise ("Holloway vs. The Korean Zombie" → drop "the"). */
const STOPWORDS = new Set(["the", "and"]);

/** Name/nickname tokens worth matching on (≥3 chars, minus filler words). */
function nameTokens(name: string | null | undefined): string[] {
  if (!name) return [];
  return normalize(name)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** The "A vs. B" portion after the "UFC 308:" / "UFC Fight Night:" prefix. */
function headlineOf(eventTitle: string): string {
  const colon = eventTitle.indexOf(":");
  return normalize(colon >= 0 ? eventTitle.slice(colon + 1) : eventTitle);
}

/**
 * Does this fighter appear in the event's headline? Matches any real-name OR
 * nickname token — handles Western (surname), Asian (family-name-first) order,
 * AND nickname titles ("… vs. The Korean Zombie", "… vs. Cowboy").
 */
function inHeadline(headline: string, fighterName: string, nickname?: string | null): boolean {
  const toks = [...nameTokens(fighterName), ...nameTokens(nickname)];
  return toks.some((t) => headline.includes(t));
}

export interface MainEventCandidate {
  id: string;
  boutOrder: number | null;
  redName: string;
  blueName: string;
  redNickname?: string | null;
  blueNickname?: string | null;
}

/**
 * The main-event bout id for an event, or null if neither signal resolves it.
 * boutOrder wins when any bout has it; otherwise the title-headline match.
 */
export function identifyMainEventBoutId(
  bouts: MainEventCandidate[],
  eventTitle: string | null
): string | null {
  if (bouts.length === 0) return null;

  const withOrder = bouts.filter((b) => b.boutOrder != null);
  if (withOrder.length > 0) {
    return withOrder.reduce((lowest, b) => (b.boutOrder! < lowest.boutOrder! ? b : lowest)).id;
  }

  if (eventTitle) {
    const headline = headlineOf(eventTitle);
    const match = bouts.find(
      (b) => inHeadline(headline, b.redName, b.redNickname) && inHeadline(headline, b.blueName, b.blueNickname)
    );
    if (match) return match.id;
  }

  return null;
}
