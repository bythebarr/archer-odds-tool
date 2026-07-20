import { verifyKey, InteractionType, InteractionResponseType } from "discord-interactions";
import { collectPlays } from "@/lib/discord/postCard";
import {
  matchPlays,
  evaluate,
  renderVerdict,
  renderAmbiguous,
  renderNoMatch,
} from "@/lib/discord/valueCheck";
import { todayEt } from "@/lib/dateEt";

/**
 * Discord interactions endpoint — the bot's request target (set as the app's
 * "Interactions Endpoint URL" in the Developer Portal). Handles Discord's PING
 * handshake and the `/value` command behind #value-check.
 *
 * Dormant-safe: with no DISCORD_PUBLIC_KEY set every request is rejected, so
 * this ships inert like the posters.
 *
 * Security: Discord signs every request (Ed25519). We MUST verify against the
 * RAW body bytes before trusting anything, so we read request.text() and parse
 * only after verifyKey passes — Discord actively probes this with bad
 * signatures and expects a 401.
 */

// Ephemeral — the reply shows only to the member who ran the command. That's a
// leak control, not a UX nicety: a public reply would turn #value-check into a
// second board where our numbers on premium plays are visible to anyone.
const EPHEMERAL = 1 << 6;

/** Discord kills an interaction that isn't answered in 3s; the board pull can exceed that. */
const DEFER = InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE;

export async function POST(request: Request) {
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey) {
    return Response.json({ error: "dormant: DISCORD_PUBLIC_KEY not set" }, { status: 503 });
  }

  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const rawBody = await request.text();

  const isValid =
    signature && timestamp && (await verifyKey(rawBody, signature, timestamp, publicKey));
  if (!isValid) {
    return new Response("invalid request signature", { status: 401 });
  }

  const interaction = JSON.parse(rawBody);

  if (interaction.type === InteractionType.PING) {
    return Response.json({ type: InteractionResponseType.PONG });
  }

  if (
    interaction.type === InteractionType.APPLICATION_COMMAND &&
    interaction.data?.name === "value"
  ) {
    const options: Array<{ name: string; value: string | number }> = interaction.data.options ?? [];
    const opt = (name: string) => options.find((o) => o.name === name)?.value;
    const query = String(opt("play") ?? "");
    const price = Number(opt("price"));

    if (!Number.isFinite(price) || price === 0) {
      return reply("Give me the American odds you're getting — e.g. `-120` or `+145`.");
    }

    // Answer within Discord's 3s window, then edit in the real reply once the
    // board is pulled. Without this a slow sport adapter shows the member a
    // "the application did not respond" error even though the lookup succeeds.
    void respondLater(interaction, query, price);
    return Response.json({ type: DEFER, data: { flags: EPHEMERAL } });
  }

  return reply("Unknown command.");
}

function reply(content: string) {
  return Response.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: EPHEMERAL },
  });
}

/**
 * Do the work after deferring, then PATCH the deferred reply. Failures are
 * reported to the member rather than swallowed — a silent "thinking…" that
 * never resolves is the worst outcome here.
 */
async function respondLater(
  interaction: { application_id: string; token: string },
  query: string,
  price: number
): Promise<void> {
  let content: string;
  try {
    const plays = await collectPlays(todayEt());
    const hits = matchPlays(query, plays);
    if (!hits.length) content = renderNoMatch(query);
    else if (hits.length > 1) content = renderAmbiguous(query, hits);
    else content = renderVerdict(evaluate(hits[0], price));
  } catch (err) {
    console.error("/value failed:", err);
    content = "Something went wrong pricing that one — try again in a moment.";
  }

  try {
    await fetch(
      `https://discord.com/api/v10/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content }),
      }
    );
  } catch (err) {
    console.error("/value follow-up failed:", err);
  }
}
