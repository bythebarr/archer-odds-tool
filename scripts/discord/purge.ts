import "dotenv/config";
import { SERVER_PLAN } from "./serverPlan";

/**
 * Empty every planned channel of everything except its current pinned copy.
 *
 * The provisioner renames and re-permissions channels in place, which is right
 * for structure and wrong for content: a channel that used to be #results still
 * holds every post from the old layout, so the room looks freshly built and
 * reads like a junk drawer. Structure was reconciled; history never was.
 *
 *   npm run discord:purge -- --apply    (without --apply it only counts)
 *
 * Pinned messages matching the CURRENT plan are kept — they're the copy the
 * provisioner just wrote. Everything else goes.
 */

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const APPLY = process.argv.includes("--apply");

const CHANNEL_TEXT = 0;
/** Discord's bulk-delete only accepts messages younger than 14 days. */
const BULK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Channel { id: string; name: string; type: number }
interface Message { id: string; content: string; timestamp: string; pinned: boolean }

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

/** Every message in a channel, oldest-last, paged out in 100s. */
async function allMessages(channelId: string): Promise<Message[]> {
  const out: Message[] = [];
  let before: string | undefined;
  for (;;) {
    const page = await api<Message[]>(
      `/channels/${channelId}/messages?limit=100${before ? `&before=${before}` : ""}`
    );
    if (!page.length) break;
    out.push(...page);
    before = page[page.length - 1].id;
    if (page.length < 100) break;
  }
  return out;
}

async function main() {
  if (!TOKEN || !GUILD) throw new Error("Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in .env");

  console.log(`\nARCHR purge — ${APPLY ? "APPLY (deleting)" : "DRY RUN (counting only)"}\n`);

  const channels = await api<Channel[]>(`/guilds/${GUILD}/channels`);
  const byName = new Map(channels.map((c) => [`${c.type}:${c.name}`, c]));

  let total = 0;
  for (const cat of SERVER_PLAN.categories) {
    for (const ch of cat.channels) {
      const live = byName.get(`${CHANNEL_TEXT}:${ch.name}`);
      if (!live) continue;

      const keep = new Set(ch.pinned ?? []);
      const messages = await allMessages(live.id);
      // Keep the current pinned copy; everything else is from a previous life.
      const doomed = messages.filter((m) => !(m.pinned && keep.has(m.content)));
      if (!doomed.length) continue;

      total += doomed.length;
      if (!APPLY) {
        console.log(`  #${ch.name} — ${doomed.length} stale message(s) WOULD BE DELETED`);
        continue;
      }

      const now = Date.now();
      const fresh = doomed.filter((m) => now - Date.parse(m.timestamp) < BULK_MAX_AGE_MS);
      const old = doomed.filter((m) => now - Date.parse(m.timestamp) >= BULK_MAX_AGE_MS);

      // Bulk where allowed (100 at a time), one-by-one for anything older than
      // 14 days, which Discord refuses to bulk-delete.
      for (let i = 0; i < fresh.length; i += 100) {
        const batch = fresh.slice(i, i + 100).map((m) => m.id);
        if (batch.length === 1) {
          await api(`/channels/${live.id}/messages/${batch[0]}`, "DELETE");
          continue;
        }
        await api(`/channels/${live.id}/messages/bulk-delete`, "POST", { messages: batch });
      }
      for (const m of old) {
        await api(`/channels/${live.id}/messages/${m.id}`, "DELETE");
      }
      console.log(`  #${ch.name} — deleted ${doomed.length} stale message(s)`);
    }
  }

  if (!total) console.log("  Every planned channel is already clean.");
  console.log(
    APPLY
      ? `\n✓ Purge complete — ${total} message(s) removed.\n`
      : `\n${total} message(s) would be removed. Re-run with --apply.\n`
  );
}

main().catch((err) => {
  console.error("\n✗", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
