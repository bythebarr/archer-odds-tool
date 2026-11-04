/**
 * Tonight's NBA starting lineups, from NBA.com's daily lineups feed (free,
 * unkeyed): the five starters each team is expected to start in the morning,
 * then the confirmed five once teams announce them, about 30 minutes before tip.
 *
 * The minutes projection (minutes.ts) takes a confirmed lineup as the player's
 * role tonight, which cuts its error from 5.38 to 5.10 minutes in the backtest.
 * Expected lineups are shown for context but don't move the projection: the
 * backtest fitted that setting on real starters, not guesses.
 *
 * The feed keys players by NBA.com ids; ours are ESPN's, so players are matched
 * by team and name.
 */

export type LineupStatus = "confirmed" | "expected";

export interface TeamLineup {
  status: LineupStatus;
  /** Normalized names (see normalizeName) of the five starters. */
  starters: string[];
}

const URL = (dateEt: string) => `https://stats.nba.com/js/data/leaders/00_daily_lineups_${dateEt.replaceAll("-", "")}.json`;

/** Lowercase, no accents, punctuation or suffixes: "Jaren Jackson Jr." and "Jaren Jackson" match. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface FeedPlayer {
  playerName?: string;
  firstName?: string;
  lastName?: string;
  lineupStatus?: string;
  rosterStatus?: string;
}
interface FeedTeam {
  teamAbbreviation?: string;
  players?: FeedPlayer[];
}

/** Team abbreviation → its lineup, from one day's feed. A team counts as confirmed only when every listed starter is. */
export function parseLineups(payload: unknown): Record<string, TeamLineup> {
  const out: Record<string, TeamLineup> = {};
  const games = (payload as { games?: { homeTeam?: FeedTeam; awayTeam?: FeedTeam }[] } | null)?.games ?? [];
  for (const g of games) {
    for (const team of [g.homeTeam, g.awayTeam]) {
      const abbr = team?.teamAbbreviation;
      const players = (team?.players ?? []).filter((p) => (p.rosterStatus ?? "Active") === "Active" && (p.playerName || p.lastName));
      if (!abbr || players.length === 0) continue;
      const confirmed = players.every((p) => (p.lineupStatus ?? "").toLowerCase() === "confirmed");
      out[abbr] = {
        status: confirmed ? "confirmed" : "expected",
        starters: players.map((p) => normalizeName(p.playerName ?? `${p.firstName ?? ""} ${p.lastName ?? ""}`)),
      };
    }
  }
  return out;
}

/** Tonight's lineups; empty when the feed is down or hasn't posted (the projection then reads his last game's role). */
export async function fetchNbaLineups(dateEt: string): Promise<Record<string, TeamLineup>> {
  try {
    const res = await fetch(URL(dateEt), {
      headers: { "user-agent": "Mozilla/5.0", referer: "https://www.nba.com/" },
      signal: AbortSignal.timeout(8000),
      next: { revalidate: 300 },
    });
    if (!res.ok) return {};
    return parseLineups(await res.json());
  } catch {
    return {};
  }
}

/**
 * His role tonight from his team's lineup: true when he's in a confirmed five,
 * false when the five is confirmed without him, undefined otherwise (not out,
 * or only expected).
 */
export function starterTonight(lineups: Record<string, TeamLineup> | undefined, team: string | undefined, name: string): boolean | undefined {
  const lineup = team ? lineups?.[team] : undefined;
  if (!lineup || lineup.status !== "confirmed") return undefined;
  return lineup.starters.includes(normalizeName(name));
}
