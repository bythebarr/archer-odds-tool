import { prisma } from "@/lib/prisma";

/**
 * When each NBA prop quote on these games was last read
 * ("player|stat|book|side|point" → polledAt), from the current-line table the
 * slate itself is built from. The research screen and the v2 capture use it to
 * flag aging and stale prices; nothing is inferred when a quote is missing.
 */
export async function nbaQuoteAges(gameIds: string[]): Promise<(key: string) => Date | null> {
  if (!gameIds.length) return () => null;
  const lines = await prisma.currentNbaPropLine.findMany({
    where: { gameId: { in: gameIds } },
    select: { nbaPlayerId: true, stat: true, bookKey: true, side: true, point: true, polledAt: true },
  });
  const map = new Map(lines.map((l) => [`${l.nbaPlayerId}|${l.stat}|${l.bookKey}|${l.side}|${l.point}`, l.polledAt]));
  return (key) => map.get(key) ?? null;
}
