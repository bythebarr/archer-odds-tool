import { prisma } from "@/lib/prisma";
import type { MarketType } from "@/generated/prisma/client";

function parseMarket(value: string | null): MarketType | undefined {
  if (value === "h2h" || value === "spreads" || value === "totals") return value;
  return undefined;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const { gameId } = await params;
  const { searchParams } = new URL(request.url);
  const market = parseMarket(searchParams.get("market"));

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: { homeTeam: true, awayTeam: true },
  });

  if (!game) {
    return Response.json({ error: "Game not found" }, { status: 404 });
  }

  const lines = await prisma.currentOddsLine.findMany({
    where: { gameId, ...(market ? { marketType: market } : {}) },
    include: { book: true },
    orderBy: [{ marketType: "asc" }, { side: "asc" }, { priceAmerican: "asc" }],
  });

  return Response.json({
    game: {
      id: game.id,
      scheduledStartUtc: game.scheduledStartUtc,
      status: game.status,
      homeTeam: { id: game.homeTeam.id, name: game.homeTeam.name },
      awayTeam: { id: game.awayTeam.id, name: game.awayTeam.name },
    },
    lines: lines.map((l) => ({
      bookKey: l.bookKey,
      bookName: l.book.displayName,
      marketType: l.marketType,
      side: l.side,
      point: l.point,
      priceAmerican: l.priceAmerican,
      polledAt: l.polledAt,
    })),
  });
}
