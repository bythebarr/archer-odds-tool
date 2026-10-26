/**
 * Teammate absences, client-safe: when a key teammate is out, the useful
 * history is the games this player has already played WITHOUT him — that's
 * where his real minutes, touches and shots in that situation show up
 * ("with/without" splits). The projections blend those games in by how many
 * there are.
 */
export interface Absence {
  name: string;
  status: string;
  /** ET dates the absent player played for this team (two seasons). */
  playedDates: string[];
  /** How much he usually plays (NBA minutes, NFL touches + targets): the absences that matter. */
  usage: number;
}

/**
 * This player's games with every listed teammate missing: on or after the
 * first date they shared a team in this window, and on none of the absent
 * players' game dates.
 */
export function gamesWithout<L extends { date: string }>(logs: L[], absences: Absence[]): L[] {
  if (absences.length === 0) return [];
  const played = absences.map((a) => new Set(a.playedDates));
  const since = absences
    .map((a) => a.playedDates.reduce((min, d) => (d < min ? d : min), "9999-12-31"))
    .reduce((max, d) => (d > max ? d : max), "0000-00-00");
  return logs.filter((l) => l.date >= since && played.every((set) => !set.has(l.date)));
}

/** Weight on the without-games given how many there are; `k` is the games' worth of the full-history estimate. */
export function withoutWeight(games: number, k: number): number {
  return games / (games + k);
}
