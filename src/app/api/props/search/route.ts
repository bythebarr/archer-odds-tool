import { searchMlbPlayers } from "@/lib/queries/props";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? "";
  const players = await searchMlbPlayers(q, 20);
  return Response.json(players);
}
