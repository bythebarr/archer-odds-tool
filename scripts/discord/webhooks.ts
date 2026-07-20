import "dotenv/config";
import { appendFileSync, readFileSync } from "node:fs";

/**
 * Create (or reuse) the posting webhooks and write them into .env.
 *
 * Every daily post goes through a webhook rather than the bot, so this is the
 * step that connects the code to the room. Done by hand it's five trips through
 * Discord's UI, copying five long URLs; done here it's idempotent and the URLs
 * land straight in .env where the scripts expect them.
 *
 *   npm run discord:webhooks
 *
 * .env is gitignored. These URLs are write-access to a channel — treat them like
 * passwords. Production reads its own copies from Vercel, not this file.
 */

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const CHANNEL_TEXT = 0;

/** Which channel feeds which env var. The plan's channel names are the keys. */
const WIRING: Array<{ channel: string; env: string; what: string }> = [
  { channel: "👑-todays-card", env: "DISCORD_WEBHOOK_URL", what: "the handpicked card" },
  { channel: "🎁-free-play", env: "DISCORD_FREE_WEBHOOK_URL", what: "the daily free play" },
  { channel: "📈-the-firehose", env: "DISCORD_SLATE_WEBHOOK_URL", what: "the full +EV slate" },
  { channel: "📊-the-ledger", env: "DISCORD_RESULTS_WEBHOOK_URL", what: "the results recap" },
  { channel: "📚-sharp-school", env: "DISCORD_TIPS_WEBHOOK_URL", what: "the daily tip" },
];

const WEBHOOK_NAME = "ARCHR";

interface Channel { id: string; name: string; type: number }
interface Webhook { id: string; name: string; url?: string; token?: string }

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${TOKEN}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function main() {
  if (!TOKEN || !GUILD) throw new Error("Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in .env");

  const channels = await api<Channel[]>(`/guilds/${GUILD}/channels`);
  const byName = new Map(channels.filter((c) => c.type === CHANNEL_TEXT).map((c) => [c.name, c]));
  const env = readFileSync(".env", "utf8");

  const lines: string[] = [];
  console.log("\nARCHR webhooks\n==============\n");

  for (const w of WIRING) {
    const ch = byName.get(w.channel);
    if (!ch) {
      console.log(`  ✗ #${w.channel} not found — run npm run discord:sync first`);
      continue;
    }
    if (env.includes(`${w.env}=https://`)) {
      console.log(`  ${w.env} — already in .env, leaving it`);
      continue;
    }

    // Reuse ours if it exists; Discord happily creates duplicates otherwise.
    const existing = await api<Webhook[]>(`/channels/${ch.id}/webhooks`);
    let hook = existing.find((h) => h.name === WEBHOOK_NAME);
    if (!hook) hook = await api<Webhook>(`/channels/${ch.id}/webhooks`, "POST", { name: WEBHOOK_NAME });

    const url = hook.url ?? `https://discord.com/api/webhooks/${hook.id}/${hook.token}`;
    lines.push(`${w.env}=${url}`);
    console.log(`  ${w.env} → #${w.channel}  (${w.what})`);
  }

  if (lines.length) {
    appendFileSync(".env", `\n# Discord posting webhooks — local testing only.\n${lines.join("\n")}\n`);
    console.log(`\n✓ Wrote ${lines.length} webhook URL(s) to .env`);
  }
  console.log("\nProduction needs its OWN copies set in Vercel — these are for local testing.\n");
}

main().catch((err) => {
  console.error("\n✗", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
