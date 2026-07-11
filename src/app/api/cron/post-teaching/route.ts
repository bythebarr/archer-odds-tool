import { checkCronAuth } from "@/lib/cronAuth";
import { postTeachingDrop } from "@/lib/discord/mosesDaily";

/**
 * Moses 101 — the rotating daily glossary lesson. Dormant until
 * DISCORD_MOSES_WEBHOOK_URL is set (postTeachingDrop returns `{ posted: false }`),
 * so it's safe on the cron schedule before the room is opened.
 */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const result = await postTeachingDrop();
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ posted: false, error: message }, { status: 502 });
  }
}
