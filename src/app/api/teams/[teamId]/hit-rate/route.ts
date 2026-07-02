import { getTeamHitRate } from "@/lib/queries/hitRate";
import { parseMarketType } from "@/lib/marketType";

const MIN_WINDOW = 1;
const MAX_WINDOW = 50;

function clampWindow(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) return 10;
  return Math.min(MAX_WINDOW, Math.max(MIN_WINDOW, parsed));
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { teamId } = await params;
  const { searchParams } = new URL(request.url);

  const betType = parseMarketType(searchParams.get("betType")) ?? "h2h";
  const sideParam = searchParams.get("side");
  const side = sideParam === "over" || sideParam === "under" ? sideParam : undefined;
  const window = clampWindow(searchParams.get("window"));

  const result = await getTeamHitRate(teamId, betType, window, side);
  return Response.json({ teamId, betType, side: side ?? null, ...result });
}
