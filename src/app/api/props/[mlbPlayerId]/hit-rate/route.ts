import { getMlbPlayerById } from "@/lib/queries/props";
import { computePropHitRateSplits } from "@/lib/props/hitRate";
import { parseStatCategory, parseDirection } from "@/lib/statCategory";

const MIN_LINE = -0.5;
const MAX_LINE = 50;

function clampLine(raw: string | null): number {
  const parsed = Number.parseFloat(raw ?? "");
  if (!Number.isFinite(parsed)) return 0.5;
  return Math.min(MAX_LINE, Math.max(MIN_LINE, parsed));
}

export async function GET(request: Request, { params }: { params: Promise<{ mlbPlayerId: string }> }) {
  const { mlbPlayerId } = await params;
  const { searchParams } = new URL(request.url);

  const statCategory = parseStatCategory(searchParams.get("statCategory")) ?? "hits";
  const direction = parseDirection(searchParams.get("direction")) ?? "over";
  const line = clampLine(searchParams.get("line"));

  const player = await getMlbPlayerById(mlbPlayerId);
  if (!player) return Response.json({ error: "Player not found" }, { status: 404 });

  const splits = await computePropHitRateSplits({ mlbPlayerId, statCategory, line, direction });
  return Response.json({ mlbPlayerId, statCategory, line, direction, splits });
}
