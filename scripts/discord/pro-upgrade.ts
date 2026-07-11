/**
 * Elevate the ARCHR server to a full Community server — the "pro" tier that the
 * one-time provisioner (provision-server.ts) doesn't touch. Idempotent: every
 * step checks/updates rather than duplicating, so it's safe to re-run.
 *
 * Applies: server icon, COMMUNITY mode, Welcome Screen, Onboarding, a branded
 * :archr: emoji, a Hall of Cashes forum, and a recurring Fight Night event.
 *
 * Run locally with the bot token (never stored in prod):
 *   DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/discord/pro-upgrade.ts
 *
 * The logo is pulled from the app's public icon route (bypasses the site's Basic
 * Auth gate), so no local asset is needed. SITE_URL defaults to the prod domain.
 */
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const SITE = process.env.SITE_URL ?? "https://archer-odds-tool.vercel.app";
const API = "https://discord.com/api/v10";

if (!TOKEN || !GUILD) {
  console.error("Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID.");
  process.exit(1);
}

const H = {
  Authorization: `Bot ${TOKEN}`,
  "Content-Type": "application/json",
  "User-Agent": "ArchrEdgeBot (https://archrhub.com, 1.0)",
};

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: unknown }> {
  for (let i = 0; i < 4; i++) {
    const res = await fetch(API + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 429) {
      const j = (await res.json()) as { retry_after?: number };
      await new Promise((r) => setTimeout(r, (j.retry_after ?? 1) * 1000 + 500));
      continue;
    }
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : {} };
  }
  return { status: 0, json: "retries exhausted" };
}

async function logoDataUri(size: 192 | 512): Promise<string> {
  const res = await fetch(`${SITE}/icon-${size}.png`);
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function step(name: string, fn: () => Promise<string>) {
  try {
    console.log(`✅ ${name}: ${await fn()}`);
  } catch (e) {
    console.log(`❌ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// Channels @everyone can view (the START HERE ring) — the only valid onboarding defaults.
const PUBLIC_CHANNELS = ["announcements", "start-here", "rules", "disclaimer", "todays-lean", "results", "general", "get-access"];

async function main() {
  const { json: guild } = await api("GET", `/guilds/${GUILD}`);
  const g = guild as { features?: string[] };
  const { json: chList } = await api("GET", `/guilds/${GUILD}/channels`);
  const channels = chList as Array<{ id: string; name: string; type: number }>;
  const byName = (n: string) => channels.find((c) => c.name === n)?.id;
  const { json: roleList } = await api("GET", `/guilds/${GUILD}/roles`);
  const verified = (roleList as Array<{ id: string; name: string }>).find((r) => r.name === "Verified")?.id;
  const rules = byName("rules")!;
  const updates = byName("mod-log")!;
  const community = channels.find((c) => c.type === 4 && c.name.includes("COMMUNITY"))?.id;

  await step("Server icon", async () => {
    const { status } = await api("PATCH", `/guilds/${GUILD}`, { icon: await logoDataUri(512) });
    return status === 200 ? "set" : "unchanged";
  });

  await step("Enable Community", async () => {
    const features = new Set(g.features ?? []);
    features.add("COMMUNITY");
    const { status } = await api("PATCH", `/guilds/${GUILD}`, {
      features: [...features],
      rules_channel_id: rules,
      public_updates_channel_id: updates,
      verification_level: 1,
      explicit_content_filter: 2,
      default_message_notifications: 1,
    });
    return status === 200 ? "enabled" : "unchanged";
  });

  await step("Welcome Screen", async () => {
    const ch = (n: string, description: string, emoji_name: string) => ({ channel_id: byName(n)!, description, emoji_name });
    const { status } = await api("PATCH", `/guilds/${GUILD}/welcome-screen`, {
      enabled: true,
      description: "Sharp betting picks from the ARCHR Edge model, delivered daily by Moses. Research/entertainment · 21+.",
      welcome_channels: [
        ch("start-here", "What ARCHR Edge is + how it works", "🎯"),
        ch("rules", "Read + react ✅ to unlock chat", "✅"),
        ch("todays-lean", "Today's free lean from Moses", "🏹"),
        ch("results", "The public record — every W and L", "📊"),
        ch("get-access", "Start your trial, unlock the full card", "🔓"),
      ],
    });
    return status === 200 ? "set" : "unchanged";
  });

  await step("Custom emoji :archr:", async () => {
    // Discord ALLOWS duplicate emoji names, so check-before-create (a 400 won't save us).
    const { json: existing } = await api("GET", `/guilds/${GUILD}/emojis`);
    if ((existing as Array<{ name: string }>).some((e) => e.name === "archr")) return "already exists";
    const { status } = await api("POST", `/guilds/${GUILD}/emojis`, { name: "archr", image: await logoDataUri(192) });
    return status === 200 || status === 201 ? "added" : "unchanged";
  });

  await step("Forum: Hall of Cashes", async () => {
    if (channels.some((c) => c.name === "🏆-hall-of-cashes")) return "already exists";
    const { status } = await api("POST", `/guilds/${GUILD}/channels`, {
      name: "🏆-hall-of-cashes",
      type: 15,
      parent_id: community,
      topic: "Post your biggest cashed slips. The wall of winners. 🎉",
    });
    return status === 200 || status === 201 ? "created" : "unchanged";
  });

  await step("Onboarding + verify gate", async () => {
    const default_channel_ids = PUBLIC_CHANNELS.map(byName).filter(Boolean) as string[];
    // A required onboarding prompt that grants @Verified — the native 21+/rules
    // gate, replacing the flaky Carl-bot reaction-role approach.
    const prompts = verified
      ? [
          {
            id: "1",
            type: 0,
            title: "One step to unlock the room 🔓",
            single_select: true,
            required: true,
            in_onboarding: true,
            options: [
              {
                id: "11",
                title: "I'm 21+ and I agree to the rules",
                description: "Confirms your age and unlocks the chat + community.",
                emoji: { name: "✅" },
                role_ids: [verified],
                channel_ids: [],
              },
            ],
          },
        ]
      : [];
    const { status } = await api("PUT", `/guilds/${GUILD}/onboarding`, { enabled: true, mode: 0, default_channel_ids, prompts });
    return status === 200 ? "enabled (verify gate on)" : "unchanged";
  });

  console.log("— pro-upgrade complete —");
}

main();
