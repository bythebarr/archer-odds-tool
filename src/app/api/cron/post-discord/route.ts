import { checkCronAuth } from "@/lib/cronAuth";
import { postDailyCardToDiscord } from "@/lib/discord/postCard";

/**
 * Posts today's +EV card to the paid Discord. Dormant until DISCORD_WEBHOOK_URL
 * is set (postDailyCardToDiscord returns `{ posted: false }` and this is a
 * no-op), so it's safe to have on the cron schedule before the Discord exists.
 */
export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const result = await postDailyCardToDiscord();
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ posted: false, error: message }, { status: 502 });
  }
}
