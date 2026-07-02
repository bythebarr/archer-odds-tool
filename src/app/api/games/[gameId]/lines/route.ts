import { getGameWithLines } from "@/lib/queries/games";
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

  const result = await getGameWithLines(gameId, market);
  if (!result) {
    return Response.json({ error: "Game not found" }, { status: 404 });
  }

  return Response.json(result);
}
