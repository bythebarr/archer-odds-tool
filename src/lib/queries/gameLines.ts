import { prisma } from "@/lib/prisma";
import { modeNumber, type GameLines } from "@/lib/propModel/environment";

/**
 * The consensus spread and total for each game — the environment every prop
 * projection starts from (see propModel/environment). Main lines only; the
 * most common number across books.
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
    select: { gameId: true, marketType: true, point: true },
  });
  const out: Record<string, GameLines> = {};
  for (const id of gameIds) {
    const mine = rows.filter((r) => r.gameId === id && r.point !== null);
    out[id] = {
      homeSpread: modeNumber(mine.filter((r) => r.marketType === "spreads").map((r) => r.point!)),
      total: modeNumber(mine.filter((r) => r.marketType === "totals").map((r) => r.point!)),
    };
  }
  return out;
}
