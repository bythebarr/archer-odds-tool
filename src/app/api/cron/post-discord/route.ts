import { checkCronAuth } from "@/lib/cronAuth";
import { collectPlays, postDailyCardToDiscord } from "@/lib/discord/postCard";
import { cardTiming, cardDropTime, tipTiming, LEAD_HOURS } from "@/lib/discord/schedule";
import { postDailyTip } from "@/lib/discord/postTips";
import { alreadyPosted, markPosted } from "@/lib/discord/postMarker";
import { todayEt } from "@/lib/dateEt";

/**
 * The card tick. Runs frequently and usually does nothing: it posts the day's
 * card/free-play/slate exactly once, LEAD_HOURS before the first event of the
 * day — whatever sport that is — rather than on a fixed clock (see ./schedule).
 *
 * It also carries the daily #tips post, which rides this tick rather than a cron
 * of its own — same once-a-day rhythm, its own channel, its own marker. The tip
 * is deliberately NOT gated on the card: it goes out on a morning with no slate
 * too, since those are exactly the days a free member needs a reason to open the
 * room.
 *
 * Dormant-safe on two levels: with no DISCORD_WEBHOOK_URL the poster no-ops, and
 * the timing gate means an extra invocation can't double-post.
 */
export async function GET(request: Request) {
  return POST(request);
}

/**
 * Post the day's tip if it's due. Isolated and swallowed: a #tips failure must
 * never take down the card, which is the post that actually matters.
 */
async function maybePostTip(dateEt: string): Promise<Record<string, unknown>> {
  try {
    const timing = tipTiming(new Date(), await alreadyPosted("post-tip", dateEt));
    if (!timing.post) return { posted: false, skipped: timing.reason };
    const result = await postDailyTip(dateEt);
    if (result.posted) await markPosted("post-tip", dateEt);
    return { ...result };
  } catch (err) {
    console.error("daily tip failed (card unaffected):", err);
    return { posted: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;

  try {
    const dateEt = todayEt();

    // 📚 The daily tip — independent of the card in every way except this tick.
    const tip = await maybePostTip(dateEt);

    // The board is needed to know the first start time, so collect once and hand
    // it to the poster rather than pulling every sport's plays twice.
    const plays = await collectPlays(dateEt);
    const posted = await alreadyPosted("post-card", dateEt);
    const timing = cardTiming(new Date(), plays, posted);

    if (!timing.post) {
      const dropAt = cardDropTime(plays);
      return Response.json({
        posted: false,
        skipped: timing.reason,
        leadHours: LEAD_HOURS,
        dropAt: dropAt?.toISOString() ?? null,
        boardSize: plays.length,
        tip,
      });
    }

    const result = await postDailyCardToDiscord(dateEt, plays);
    // Mark only on a real post — a dormant webhook must not burn the day's slot,
    // or wiring the webhook up later that day would silently post nothing.
    if (result.posted) await markPosted("post-card", dateEt);
    return Response.json({ ...result, tip });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ posted: false, error: message }, { status: 502 });
  }
}
