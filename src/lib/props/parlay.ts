/**
 * The same-game parlay lab: how often have all of these legs hit together?
 *
 * Each leg brings its player's game logs. A past game counts when every leg's
 * player played in it (the same game, not just the same night) and every leg's
 * stat was on the box score. In each one we check every leg at its line and
 * count the games where all of them cashed. Next to that sits what you'd expect
 * if the legs were independent (the product of each leg's own rate over the
 * same games): the gap is the correlation the books price into a same-game
 * parlay, in your favor or against it. Pure; sport-agnostic.
 */
import { tallyPropHits, type PropDirection, type PropHitRateResult } from "./tally";

/** One past game of one leg's player, with that leg's stat (null = not on the box score). */
export interface ParlayLog {
  /** ET date, YYYY-MM-DD. */
  date: string;
  opponent: string;
  isHome: boolean;
  season: number;
  value: number | null;
}

export interface ParlayLeg {
  /** `${playerId}:${stat}`: one leg per player and stat. */
  id: string;
  /** Tonight's game: a parlay here is one game. */
  gameId: string;
  playerName: string;
  /** The player's team abbreviation (matches opponents' logs to the same game). */
  team: string;
  /** e.g. "PTS", "REC YDS". */
  statShort: string;
  side: PropDirection;
  /** How the side reads for this stat: "Over"/"Under", or "Yes"/"No". */
  sideLabel: string;
  point: number;
  /** ARCHR's chance this leg cashes tonight; null without a projection. */
  modelProb: number | null;
  logs: ParlayLog[];
}

/** One past game the whole parlay can be read against. */
export interface ParlayGame {
  date: string;
  season: number;
  /** "AWAY@HOME". */
  matchup: string;
  /** Did each leg cash, in leg order. */
  legs: boolean[];
  all: boolean;
}

export interface ParlayHistory {
  /** Shared games, most recent first. */
  games: ParlayGame[];
  /** Every leg cashed, over every shared game. */
  together: PropHitRateResult;
  /** The same count over the last 10 shared games and this season's. */
  last10: PropHitRateResult;
  thisSeason: PropHitRateResult;
  /** Each leg's own rate over the shared games. */
  perLeg: PropHitRateResult[];
  /** What `together` would be if the legs were independent; null with no shared games. */
  independent: number | null;
  /** ARCHR's chance tonight, if the legs were independent; null when a leg has no projection. */
  model: number | null;
}

function cashes(value: number, point: number, side: PropDirection): boolean {
  return side === "over" ? value > point : value < point;
}

/** The game a log belongs to, named the same way from either team's side. */
export function parlayGameKey(team: string, log: Pick<ParlayLog, "date" | "opponent" | "isHome">): string {
  return `${log.date}|${log.isHome ? `${log.opponent}@${team}` : `${team}@${log.opponent}`}`;
}

function count(games: ParlayGame[]): PropHitRateResult {
  const hits = games.filter((g) => g.all).length;
  return { hits, sampleSize: games.length, hitRate: games.length ? hits / games.length : null };
}

export function parlayHistory(legs: ParlayLeg[], season: number): ParlayHistory {
  const byKey = legs.map((leg) => {
    const m = new Map<string, ParlayLog>();
    for (const l of leg.logs) if (l.value !== null) m.set(parlayGameKey(leg.team, l), l);
    return m;
  });
  const games: ParlayGame[] = [];
  if (legs.length > 0) {
    for (const [key, first] of byKey[0]) {
      if (!byKey.every((m) => m.has(key))) continue;
      const results = legs.map((leg, i) => cashes(byKey[i].get(key)!.value!, leg.point, leg.side));
      games.push({ date: first.date, season: first.season, matchup: key.split("|")[1], legs: results, all: results.every(Boolean) });
    }
  }
  games.sort((a, b) => b.date.localeCompare(a.date));

  const perLeg = legs.map((leg, i) =>
    tallyPropHits(
      games.map((g) => byKey[i].get(`${g.date}|${g.matchup}`)!.value!),
      leg.point,
      leg.side
    )
  );
  const independent = games.length ? perLeg.reduce((p, r) => p * (r.hitRate ?? 0), 1) : null;
  const model = legs.length && legs.every((l) => l.modelProb !== null) ? legs.reduce((p, l) => p * l.modelProb!, 1) : null;

  return {
    games,
    together: count(games),
    last10: count(games.slice(0, 10)),
    thisSeason: count(games.filter((g) => g.season === season)),
    perLeg,
    independent,
    model,
  };
}

/** Add a leg (or replace this player's leg on the same stat); a leg from another game starts a new parlay. */
export function addLeg(legs: ParlayLeg[], leg: ParlayLeg): ParlayLeg[] {
  if (legs.length && legs[0].gameId !== leg.gameId) return [leg];
  const i = legs.findIndex((l) => l.id === leg.id);
  return i === -1 ? [...legs, leg] : legs.map((l, j) => (j === i ? leg : l));
}
