import "dotenv/config";
import { SERVER_PLAN, overwritesFor } from "./serverPlan";

/**
 * Read-only audit: does the REAL server match the plan?
 *
 * The provisioner reports what it attempted. This reports what actually stuck —
 * a different question, and the one that matters, since several of tonight's
 * edits were rejected by Discord after being logged as attempted.
 *
 *   npm run discord:audit
 *
 * Touches nothing. Every check is a GET.
 */

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;

const CHANNEL_TEXT = 0;
const CHANNEL_CATEGORY = 4;
const VIEW = BigInt(1024);
const SEND = BigInt(2048);

interface Role { id: string; name: string }
interface Overwrite { id: string; type: number; allow: string; deny: string }
interface Channel {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  permission_overwrites?: Overwrite[];
}
interface Guild {
  features: string[];
  rules_channel_id: string | null;
  public_updates_channel_id: string | null;
  safety_alerts_channel_id: string | null;
}
interface AutoModRule {
  id: string;
  name: string;
  enabled: boolean;
  exempt_channels: string[];
  trigger_metadata?: { regex_patterns?: string[] };
}

const problems: string[] = [];
const warnings: string[] = [];
const ok: string[] = [];

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Overwrites compare as a set — Discord returns them in arbitrary order. */
function sameOverwrites(actual: Overwrite[], expected: ReturnType<typeof overwritesFor>): boolean {
  const norm = (o: { id: string; allow: string; deny: string }) => `${o.id}:${o.allow}:${o.deny}`;
  const a = new Set(actual.filter((o) => o.allow !== "0" || o.deny !== "0").map(norm));
  const e = new Set(expected.map(norm));
  if (a.size !== e.size) return false;
  for (const x of e) if (!a.has(x)) return false;
  return true;
}

async function main() {
  if (!TOKEN || !GUILD) throw new Error("Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID in .env");

  const guild = await api<Guild>(`/guilds/${GUILD}`);
  const roles = await api<Role[]>(`/guilds/${GUILD}/roles`);
  const channels = await api<Channel[]>(`/guilds/${GUILD}/channels`);

  const roleByName = new Map(roles.map((r) => [r.name, r]));
  const roleId = (n: string) => roleByName.get(n)?.id ?? GUILD;
  const byName = new Map(channels.map((c) => [`${c.type}:${c.name}`, c]));

  console.log("\nARCHR Discord — audit\n=====================\n");

  // 1) Roles
  for (const r of SERVER_PLAN.roles) {
    if (roleByName.has(r.name)) ok.push(`role @${r.name}`);
    else problems.push(`role @${r.name} is MISSING`);
  }

  // 2) Channels: existence, placement, permissions
  for (const cat of SERVER_PLAN.categories) {
    const parent = byName.get(`${CHANNEL_CATEGORY}:${cat.name}`);
    if (!parent) {
      problems.push(`category ${cat.name} is MISSING`);
      continue;
    }
    for (const ch of cat.channels) {
      const actual = byName.get(`${CHANNEL_TEXT}:${ch.name}`);
      if (!actual) {
        problems.push(`#${ch.name} is MISSING`);
        continue;
      }
      if (actual.parent_id !== parent.id) {
        problems.push(`#${ch.name} is in the wrong category`);
      }
      const expected = overwritesFor(cat.visibility, Boolean(ch.readOnly), GUILD, roleId);
      if (!sameOverwrites(actual.permission_overwrites ?? [], expected)) {
        const ow = actual.permission_overwrites ?? [];
        const everyone = ow.find((o) => o.id === GUILD);
        const deny = BigInt(everyone?.deny ?? "0");
        const detail: string[] = [];
        if (cat.visibility === "premium" && (deny & VIEW) === BigInt(0)) {
          problems.push(`🔓 #${ch.name} is PREMIUM but @everyone can SEE it`);
          continue;
        }
        if (ch.readOnly && (deny & SEND) === BigInt(0)) {
          problems.push(`✍️ #${ch.name} should be read-only but members CAN POST`);
          continue;
        }
        detail.push("permissions differ from the plan (cosmetic unless flagged above)");
        warnings.push(`#${ch.name}: ${detail.join(", ")}`);
      } else {
        ok.push(`#${ch.name}`);
      }
    }
  }

  // 3) Leftovers
  const planned = new Set<string>();
  for (const cat of SERVER_PLAN.categories) {
    planned.add(`${CHANNEL_CATEGORY}:${cat.name}`);
    for (const ch of cat.channels) planned.add(`${CHANNEL_TEXT}:${ch.name}`);
  }
  const leftovers = channels.filter(
    (c) => (c.type === CHANNEL_TEXT || c.type === CHANNEL_CATEGORY) && !planned.has(`${c.type}:${c.name}`)
  );
  for (const l of leftovers) {
    const isReserved =
      l.id === guild.rules_channel_id ||
      l.id === guild.public_updates_channel_id ||
      l.id === guild.safety_alerts_channel_id;
    const everyoneCanSee = !(
      BigInt(l.permission_overwrites?.find((o) => o.id === GUILD)?.deny ?? "0") & VIEW
    );
    if (everyoneCanSee) {
      problems.push(`👀 leftover #${l.name} is still VISIBLE to members${isReserved ? " (holds a reserved slot)" : ""}`);
    } else {
      warnings.push(`leftover #${l.name} exists but is hidden from members`);
    }
  }

  // 4) The ✅ rules gate
  if (!guild.features.includes("COMMUNITY")) {
    problems.push("Community is OFF — the ✅ rules gate cannot work");
  } else if (!guild.features.includes("MEMBER_VERIFICATION_GATE_ENABLED")) {
    problems.push("the ✅ rules gate is NOT enforced (members can talk without accepting)");
  } else {
    ok.push("✅ rules gate enforced");
  }

  // 5) Image-only AutoMod
  const restricted = SERVER_PLAN.categories.flatMap((c) => c.channels).filter((c) => c.imageOnly);
  if (restricted.length) {
    const rules = await api<AutoModRule[]>(`/guilds/${GUILD}/auto-moderation/rules`);
    const rule = rules.find((r) => r.name === "ARCHR: images only");
    if (!rule) problems.push("image-only AutoMod rule is MISSING");
    else if (!rule.enabled) problems.push("image-only AutoMod rule exists but is DISABLED");
    else {
      // The inversion is the dangerous part: any non-exempt channel is text-blocked.
      const restrictedIds = new Set(
        restricted.map((c) => byName.get(`${CHANNEL_TEXT}:${c.name}`)?.id).filter(Boolean) as string[]
      );
      const exempt = new Set(rule.exempt_channels);
      const wronglyBlocked = channels.filter(
        (c) => c.type === CHANNEL_TEXT && !restrictedIds.has(c.id) && !exempt.has(c.id)
      );
      if (wronglyBlocked.length) {
        problems.push(
          `🚨 AutoMod is blocking text in channels it shouldn't: ${wronglyBlocked.map((c) => "#" + c.name).join(", ")}`
        );
      } else {
        ok.push(`image-only enforced in ${restricted.map((c) => "#" + c.name).join(", ")}`);
      }
    }
  }

  // 6) Pins present where the plan expects them
  for (const cat of SERVER_PLAN.categories) {
    for (const ch of cat.channels) {
      if (!ch.pinned?.length) continue;
      const actual = byName.get(`${CHANNEL_TEXT}:${ch.name}`);
      if (!actual) continue;
      try {
        const raw = await api<unknown>(`/channels/${actual.id}/pins`);
        const pins = Array.isArray(raw)
          ? (raw as { content: string }[])
          : (raw as { items: { message: { content: string } }[] }).items.map((i) => i.message);
        const matched = ch.pinned.filter((want) => pins.some((p) => p.content === want)).length;
        if (matched < ch.pinned.length) {
          problems.push(`📌 #${ch.name}: ${matched}/${ch.pinned.length} pins match the current copy`);
        } else ok.push(`#${ch.name} pins current`);
      } catch {
        warnings.push(`#${ch.name}: couldn't read pins`);
      }
    }
  }

  console.log(`✅ PASS (${ok.length})`);
  for (const o of ok) console.log(`   ${o}`);
  if (warnings.length) {
    console.log(`\n⚠️  WARNINGS (${warnings.length})`);
    for (const w of warnings) console.log(`   ${w}`);
  }
  console.log(`\n${problems.length ? "❌" : "✅"} PROBLEMS (${problems.length})`);
  for (const p of problems) console.log(`   ${p}`);
  console.log(
    problems.length
      ? "\nThe server does NOT match the plan — see above.\n"
      : "\nThe server matches the plan.\n"
  );
}

main().catch((err) => {
  console.error("\n✗", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
