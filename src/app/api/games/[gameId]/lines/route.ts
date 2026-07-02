import { getGameWithLines } from "@/lib/queries/games";
import { parseMarketType } from "@/lib/marketType";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gameId: string }> }
) {
  const { gameId } = await params;
  const { searchParams } = new URL(request.url);
  const market = parseMarketType(searchParams.get("market"));

  const result = await getGameWithLines(gameId, market);
  if (!result) {
    return Response.json({ error: "Game not found" }, { status: 404 });
  }

  return Response.json(result);
}
