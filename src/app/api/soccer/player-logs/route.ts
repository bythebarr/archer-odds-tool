import { soccerPlayerLogs } from "@/lib/queries/soccerProps";

/** A soccer player's last 40 matches (packed), for the props sheet. */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !/^\d{1,12}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  return Response.json({ logs: await soccerPlayerLogs(id) }, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } });
}
