import { prisma } from "@/lib/prisma";
import { wikipediaPlayerPhoto } from "@/lib/allSports/logos";

const RETRY_MS = 30 * 86_400_000;

/**
 * GET /api/soccer/player-photo?id=<ESPN athlete id> → redirect to the player's
 * Wikipedia photo, or 404 so the badge shows initials. Looked up once and kept
 * on the player (misses retried monthly); cached a week at the edge on top.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^\d{1,12}$/.test(id)) return new Response(null, { status: 400 });
  const player = await prisma.soccerPlayer.findUnique({ where: { id }, select: { name: true, photoUrl: true, photoCheckedAt: true } });
  let url = player?.photoUrl ?? null;
  if (player && !url && (!player.photoCheckedAt || Date.now() - player.photoCheckedAt.getTime() > RETRY_MS)) {
    const found = await wikipediaPlayerPhoto(player.name, /footballer|soccer|football/i, "footballer").catch(() => undefined);
    // No answer (rate limit) isn't a miss: ask again next time.
    if (found !== undefined) {
      await prisma.soccerPlayer.update({ where: { id }, data: { photoUrl: found, photoCheckedAt: new Date() } });
      url = found;
    }
  }
  const cache = { "Cache-Control": `public, s-maxage=${url ? 604800 : 86400}, stale-while-revalidate=86400` };
  return url ? new Response(null, { status: 302, headers: { ...cache, Location: url } }) : new Response(null, { status: 404, headers: cache });
}
