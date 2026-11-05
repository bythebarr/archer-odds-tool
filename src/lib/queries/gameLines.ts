import { prisma } from "@/lib/prisma";
import { modeNumber, type GameLines } from "@/lib/propModel/environment";

/** Books quoted within this long of the game's freshest quote make up its consensus. */
const CONSENSUS_WINDOW_MS = 6 * 3_600_000;

/**
 * The consensus spread and total for each game — the environment every prop
 * projection starts from (see propModel/environment). Main lines only; the
 * most common number across the books quoted lately.
 */

export async function getConsensusGameLines(gameIds: string[]): Promise<Record<string, GameLines>> {
  if (gameIds.length === 0) return {};
  const rows = await prisma.currentOddsLine.findMany({
    where: {
      gameId: { in: gameIds },
      isAlternate: false,
      OR: [
        { marketType: "spreads", side: "home" },
        { marketType: "totals", side: "over" },
      ],
    },
    select: { gameId: true, marketType: true, point: true, polledAt: true },
  });
  const out: Record<string, GameLines> = {};
  for (const id of gameIds) {
    // Only books quoted around the game's latest poll: a feed that stopped hours ago is a different market.
    const all = rows.filter((r) => r.gameId === id && r.point !== null);
    const newest = Math.max(...all.map((r) => r.polledAt.getTime()));
    const mine = all.filter((r) => newest - r.polledAt.getTime() <= CONSENSUS_WINDOW_MS);
    out[id] = {
      homeSpread: modeNumber(mine.filter((r) => r.marketType === "spreads").map((r) => r.point!)),
      total: modeNumber(mine.filter((r) => r.marketType === "totals").map((r) => r.point!)),
    };
  }
  return out;
}
