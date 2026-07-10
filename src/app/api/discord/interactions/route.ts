import { verifyKey, InteractionType, InteractionResponseType } from "discord-interactions";
import { runBetCheck, type Market, type TotalSide } from "@/lib/discord/betCheck";

/**
 * Discord interactions endpoint — the bot's request target (set as the app's
 * "Interactions Endpoint URL" in the Developer Portal). Handles Discord's PING
 * handshake and the `/betcheck` slash command.
 *
 * Dormant-safe: with no DISCORD_PUBLIC_KEY set, every request is rejected and
 * the bot simply doesn't work yet — shippable before the Discord app exists,
 * same posture as the poster.
 *
 * Security: Discord signs every request (Ed25519). We MUST verify against the
 * RAW body bytes before trusting anything, so we read request.text() and parse
 * only after verifyKey passes — Discord actively probes this with bad
 * signatures and expects a 401.
 */

// Ephemeral flag — the reply shows only to the member who ran the command, so a
// value check is personal analysis, never a public odds board in the channel.
const EPHEMERAL = 1 << 6;

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
    interaction.data?.name === "betcheck"
  ) {
    const options: Array<{ name: string; value: string }> = interaction.data.options ?? [];
    const opt = (name: string) => options.find((o) => o.name === name)?.value;
    const market = (opt("market") as Market | undefined) ?? "ml";
    const side = opt("side") as TotalSide | undefined;

    let content: string;
    try {
      const result = await runBetCheck({
        market,
        team: opt("team") ?? "",
        price: opt("price") ?? "",
        side,
        line: opt("line"),
      });
      content = result.message;
    } catch (err) {
      console.error("betcheck failed:", err);
      content = "Something went wrong grading that bet — try again in a moment.";
    }

    return Response.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: { content, flags: EPHEMERAL },
    });
  }

  return Response.json({
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content: "Unknown command.", flags: EPHEMERAL },
  });
}
