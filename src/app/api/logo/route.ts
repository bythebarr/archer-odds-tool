import { competitorLogo } from "@/lib/allSports/logos";

/**
 * GET /api/logo?sport=soccer&name=HJK%20Helsinki → redirect to the team's crest
 * (or the player's photo), or 404 so the badge falls back to initials. Found
 * once and cached on the Competitor row; cached a week at the edge on top.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const sport = params.get("sport")?.slice(0, 40) ?? "";
  const name = params.get("name")?.slice(0, 100) ?? "";
  if (!sport || !name) return new Response("sport and name required", { status: 400 });
  const url = await competitorLogo(sport, name).catch(() => null);
  const cache = { "Cache-Control": `public, s-maxage=${url ? 604800 : 86400}, stale-while-revalidate=86400` };
  return url ? new Response(null, { status: 302, headers: { ...cache, Location: url } }) : new Response(null, { status: 404, headers: cache });
}
