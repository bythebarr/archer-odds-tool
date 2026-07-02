import { getTeamHitRate } from "@/lib/queries/hitRate";
import { parseMarketType } from "@/lib/marketType";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { teamId } = await params;
  const { searchParams } = new URL(request.url);

  const betType = parseMarketType(searchParams.get("betType")) ?? "h2h";
  const sideParam = searchParams.get("side");
  const side = sideParam === "over" || sideParam === "under" ? sideParam : undefined;
  const window = Number.parseInt(searchParams.get("window") ?? "10", 10) || 10;

  const result = await getTeamHitRate(teamId, betType, window, side);
  return Response.json({ teamId, betType, side: side ?? null, ...result });
}
