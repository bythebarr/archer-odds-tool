import { listGames } from "@/lib/queries/games";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date") ?? undefined; // YYYY-MM-DD, ET calendar day

  const games = await listGames(date);
  return Response.json(games);
}
