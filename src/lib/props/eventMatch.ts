/**
 * Matches ParlayAPI's props events to our games by TEAMS, because their ids
 * can't do it.
 *
 * Parlay serves game lines and props from two different endpoints, and those
 * endpoints do not share an event-id namespace. Measured against the live API
 * on 2026-07-21: all six of that evening's pregame matchups appeared in both
 * feeds with ZERO ids in common, and `canonical_event_id` doesn't bridge them
 * either (the same game carries a different canonical id in each feed). The
 * commence_times disagree too — Tigers @ Cubs was 2026-07-22T00:06:00Z on
 * /odds and 2026-07-21T00:05:00.000Z on /props, a full day apart.
 *
 * Since we only ever store an event id from the game-lines feed, joining props
 * on `oddsApiEventId` silently matched nothing and props wrote zero rows. Teams
 * are the only field both feeds agree on, so teams are what we match on.
 *
 * The props feed's team names are dirty in their own right, which shapes the
 * algorithm below. Real examples from one pull:
 *   • "Chicago Bulls @ Texas Rangers"   — an NBA team standing in for the White Sox
 *   • "Milwaukee Brewers @ New York"    — one side truncated to the city
 *   • "Los Angeles @ St. Louis Cardinals"
 *   • " @ "                             — both sides empty
 *   • Dodgers @ Phillies listed TWICE under two different ids
 *
 * So: resolve each side independently, and require only ONE side to land
 * unambiguously. A single confident side plus the day's schedule is enough to
 * identify a game, which is what rescues every row above except the empty one.
 * Ambiguity is always resolved by refusing to match — a prop bound to the wrong
 * game produces a graded record that lies, which is worse than a missing prop.
 */

/** The subset of a game this matcher needs — keeps it testable without Prisma. */
export interface MatchableGame {
  id: string;
  homeTeamName: string;
  awayTeamName: string;
  /** Used only to break a tie when the same matchup appears twice in range. */
  scheduledStartUtc?: Date;
}

/** The subset of a props event this matcher needs. */
export interface MatchableEvent {
  eventId: string;
  homeTeam: string | null | undefined;
  awayTeam: string | null | undefined;
}

export interface EventMatchResult {
  /** Parlay props event id → our game id. Many ids may map to one game. */
  eventIdToGameId: Map<string, string>;
  /** Events we refused to bind, with the reason — reported, never silent. */
  unmatched: Array<{ eventId: string; label: string; reason: string }>;
}

function normalize(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolves one feed-supplied team name against the teams actually playing that
 * slate. Returns the matched name, or null when it's unknown OR ambiguous —
 * the caller treats both the same way, since neither can be acted on.
 *
 * Matching by prefix is what handles the truncated names, and it's also exactly
 * where ambiguity bites: "Los Angeles" prefixes both the Dodgers and the
 * Angels, and "New York" both the Yankees and the Mets. Those return null and
 * lean on the other side of the matchup instead.
 */
export function resolveTeamName(raw: string | null | undefined, candidates: Set<string>): string | null {
  const needle = normalize(raw);
  if (needle.length < 3) return null;

  for (const candidate of candidates) {
    if (normalize(candidate) === needle) return candidate;
  }

  const prefixHits = [...candidates].filter((candidate) => normalize(candidate).startsWith(`${needle} `));
  if (prefixHits.length === 1) return prefixHits[0];

  // "Chicago Bulls" for the White Sox: the city is right and the nickname is
  // wrong, so fall back to the city token alone — still refusing when the city
  // fields two teams that day.
  const city = needle.split(" ")[0];
  const cityHits = [...candidates].filter((candidate) => normalize(candidate).startsWith(`${city} `));
  if (cityHits.length === 1) return cityHits[0];

  return null;
}

export function matchPropEventsToGames(
  events: MatchableEvent[],
  games: MatchableGame[]
): EventMatchResult {
  const teamNames = new Set<string>();
  for (const game of games) {
    teamNames.add(game.homeTeamName);
    teamNames.add(game.awayTeamName);
  }

  const eventIdToGameId = new Map<string, string>();
  const unmatched: EventMatchResult["unmatched"] = [];

  for (const event of events) {
    const label = `${event.awayTeam ?? "?"} @ ${event.homeTeam ?? "?"}`;
    const home = resolveTeamName(event.homeTeam, teamNames);
    const away = resolveTeamName(event.awayTeam, teamNames);

    if (!home && !away) {
      unmatched.push({ eventId: event.eventId, label, reason: "neither team resolved" });
      continue;
    }

    // Both sides known is the strict case: the pair has to exist as scheduled,
    // in that orientation. Only one side known falls back to "which game is
    // this team playing today", which is unique except in a doubleheader.
    const hits = games.filter(
      (game) =>
        (!home || game.homeTeamName === home) && (!away || game.awayTeamName === away)
    );

    if (hits.length === 1) {
      eventIdToGameId.set(event.eventId, hits[0].id);
    } else if (hits.length > 1 && home && away) {
      // Same matchup twice in the window — a doubleheader, or a series whose
      // next two games both fall inside 24h. With BOTH teams confirmed the only
      // open question is which game, and books quote the imminent one, so the
      // earliest start is the answer. Deliberately limited to the both-sides
      // case: a lone resolved team is far weaker evidence and stays refused.
      const earliest = [...hits].sort(
        (a, b) => (a.scheduledStartUtc?.getTime() ?? 0) - (b.scheduledStartUtc?.getTime() ?? 0)
      )[0];
      eventIdToGameId.set(event.eventId, earliest.id);
    } else {
      unmatched.push({
        eventId: event.eventId,
        label,
        reason: hits.length === 0 ? "no scheduled game for those teams" : `ambiguous (${hits.length} games)`,
      });
    }
  }

  return { eventIdToGameId, unmatched };
}
