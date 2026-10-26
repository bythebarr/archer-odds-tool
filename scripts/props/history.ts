/**
 * History the props backtests share, rebuilt as of each game (no lookahead):
 * each team's scoring baseline before every game, and the closing game lines.
 */
import { prisma } from "@/lib/prisma";
import type { GameLines } from "@/lib/propModel/environment";

export interface TeamBaseline {
  /** Both teams' points per game in this team's previous games. */
  combined: number;
  /** This team's own points per game. */
  scored: number;
}

/** Per game id, each side's baseline from its previous `window` finished games (null below 4). */
export async function teamBaselinesByGame(
  sport: "nba" | "nfl",
  window: number
): Promise<Map<string, { home: TeamBaseline | null; away: TeamBaseline | null }>> {
  const games = await prisma.game.findMany({
    where: { sport, status: "final", homeScore: { not: null }, awayScore: { not: null } },
    orderBy: { scheduledStartUtc: "asc" },
    select: { id: true, homeTeamId: true, awayTeamId: true, homeScore: true, awayScore: true },
  });
  const history = new Map<string, { combined: number; scored: number }[]>();
  const baseline = (teamId: string | null): TeamBaseline | null => {
    const h = teamId ? (history.get(teamId) ?? []).slice(-window) : [];
    if (h.length < 4) return null;
    return { combined: h.reduce((a, g) => a + g.combined, 0) / h.length, scored: h.reduce((a, g) => a + g.scored, 0) / h.length };
  };
  const out = new Map<string, { home: TeamBaseline | null; away: TeamBaseline | null }>();
  for (const g of games) {
    out.set(g.id, { home: baseline(g.homeTeamId), away: baseline(g.awayTeamId) });
    const combined = g.homeScore! + g.awayScore!;
    for (const [team, scored] of [[g.homeTeamId, g.homeScore!], [g.awayTeamId, g.awayScore!]] as const) {
      if (!team) continue;
      const list = history.get(team) ?? [];
      list.push({ combined, scored });
      history.set(team, list);
    }
  }
  return out;
}

/** Per game id, the consensus closing spread (home) and total captured at grading. */
export async function closingGameLines(sport: "nba" | "nfl"): Promise<Map<string, GameLines>> {
  const rows = await prisma.gameClosingLine.findMany({
    where: {
      game: { sport },
      OR: [
        { marketType: "spreads", side: "home" },
        { marketType: "totals", side: "over" },
      ],
    },
    select: { gameId: true, marketType: true, point: true },
  });
  const out = new Map<string, GameLines>();
  for (const r of rows) {
    const lines = out.get(r.gameId) ?? { homeSpread: null, total: null };
    if (r.marketType === "spreads") lines.homeSpread = r.point;
    else lines.total = r.point;
    out.set(r.gameId, lines);
  }
  return out;
}
