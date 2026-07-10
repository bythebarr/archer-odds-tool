/**
 * Posts + pins the curated content in channelContent.ts into the matching
 * channels. Idempotent: a channel that already has ANY pinned message is left
 * alone, so re-running never duplicates. Safe to run after provisioning.
 *
 *   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npx tsx scripts/discord/seed-content.ts
 *   # add --dry-run to preview which channels would get seeded
 */

import { CHANNEL_CONTENT } from "./channelContent";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const DRY = process.argv.includes("--dry-run");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T = unknown>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${TOKEN}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) {
    const { retry_after } = (await res.json()) as { retry_after: number };
    await sleep(retry_after * 1000 + 250);
    return api(path, method, body);
  }
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  await sleep(350);
  return (res.status === 204 ? null : await res.json()) as T;
}

interface DiscordChannel { id: string; name: string; type: number; }

async function main() {
  if (!TOKEN || !GUILD) throw new Error("Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.");
  console.log(`\nARCHR content seed — ${DRY ? "DRY RUN" : "posting"}\n`);

  const channels = await api<DiscordChannel[]>(`/guilds/${GUILD}/channels`);
  const byName = new Map(channels.filter((c) => c.type === 0).map((c) => [c.name, c]));

  for (const [name, messages] of Object.entries(CHANNEL_CONTENT)) {
    const channel = byName.get(name);
    if (!channel) {
      console.log(`  #${name} — not found, skipping`);
      continue;
    }
    // Idempotency: any existing pin means this channel was already seeded.
    const pins = await api<unknown[]>(`/channels/${channel.id}/pins`);
    if (pins.length > 0) {
      console.log(`  #${name} — already has pins, skipping`);
      continue;
    }
    if (DRY) {
      console.log(`  #${name} — WOULD seed ${messages.length} message(s)`);
      continue;
    }
    for (const content of messages) {
      const msg = await api<{ id: string }>(`/channels/${channel.id}/messages`, "POST", { content });
      await api(`/channels/${channel.id}/pins/${msg.id}`, "PUT");
    }
    console.log(`  #${name} — seeded + pinned`);
  }

  console.log(`\n${DRY ? "Dry run complete." : "✓ Content seeded."}\n`);
}

main().catch((err) => {
  console.error("\n✗", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
