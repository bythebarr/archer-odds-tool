import { etDateOf } from "@/lib/dateEt";

/**
 * One card per matchup. The schedule can hold the same game twice — two Game
 * rows for the same teams on the same ET date, minted by different writers
 * (ESPN schedule sync vs keyed ingest) that never reconcile. Read paths that
 * render one card per row show the game twice; this collapse keeps, per
 * matchup, the copy carrying the freshest lines. Rows without both teams
 * are never collapsed (they aren't a matchup yet).
 */
export interface MatchupGameLike {
  id: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  scheduledStartUtc: Date;
  /** Newest line timestamp on the row, ms epoch; 0 when it carries no lines. */
  freshestLineAt: number;
}

export function matchupKeepIds(games: MatchupGameLike[]): Set<string> {
  const best = new Map<string, MatchupGameLike>();
  for (const g of games) {
    if (!g.homeTeamId || !g.awayTeamId) continue;
    const key = `${g.homeTeamId}|${g.awayTeamId}|${etDateOf(g.scheduledStartUtc)}`;
    const prev = best.get(key);
    if (!prev || g.freshestLineAt > prev.freshestLineAt) best.set(key, g);
  }
  const winners = new Set([...best.values()].map((g) => g.id));
  return new Set(games.filter((g) => !g.homeTeamId || !g.awayTeamId || winners.has(g.id)).map((g) => g.id));
}
