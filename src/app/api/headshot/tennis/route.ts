import { wikipediaHeadshot } from "@/lib/headshots";

/**
 * GET /api/headshot/tennis?name=Jannik%20Sinner → redirect to the player's
 * photo, or 404 (the badge then shows the flag). Cached a week at the edge, so
 * each player costs one Wikipedia lookup a week, not one per view.
 */
export async function GET(request: Request) {
  const name = new URL(request.url).searchParams.get("name")?.slice(0, 80) ?? "";
  if (!name) return new Response("name required", { status: 400 });
  const url = await wikipediaHeadshot(name, /tennis/i).catch(() => null);
  const cache = { "Cache-Control": "public, s-maxage=604800, stale-while-revalidate=86400" };
  return url ? new Response(null, { status: 302, headers: { ...cache, Location: url } }) : new Response(null, { status: 404, headers: cache });
}
