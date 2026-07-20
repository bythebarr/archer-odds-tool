/**
 * Erects the ARCHR Discord from serverPlan.ts — roles, categories, channels,
 * permission locks, and pinned rules/disclaimer/welcome — in one pass against
 * the Discord API. Idempotent: matches everything by name and creates only what
 * is missing, so re-running after editing the plan just fills the gaps.
 *
 *   # inspect the plan, no token needed:
 *   npx tsx scripts/discord/provision-server.ts --plan
 *
 *   # dry run against the real server (reads only, shows the diff):
 *   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npx tsx scripts/discord/provision-server.ts
 *
 *   # actually build it:
 *   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npx tsx scripts/discord/provision-server.ts --apply
 *
 *   # ...and reconcile DOWN too — report/delete anything not in the plan:
 *   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npx tsx scripts/discord/provision-server.ts --prune
 *   DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... npx tsx scripts/discord/provision-server.ts --prune --apply
 *
 * The bot must be in the server with Manage Roles + Manage Channels (Administrator
 * is simplest). Role/channel names are the idempotency key — don't rename in the
 * plan and expect a rename; it'll create a second one.
 *
 * Roles are never pruned: they carry member assignments (and Whop's mapping), so
 * an accidental delete is unrecoverable in a way a channel isn't.
 */

import { SERVER_PLAN, overwritesFor, type ChannelPlan } from "./serverPlan";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD = process.env.DISCORD_GUILD_ID;
const MODE = process.argv.includes("--apply") ? "apply" : process.argv.includes("--plan") ? "plan" : "dry";
/**
 * Reconcile *down* as well as up: delete every channel/category on the server
 * that the plan doesn't describe. Off by default — provisioning must never be
 * able to destroy something just because someone forgot a flag. Combined with
 * the default dry run, `--prune` alone only ever REPORTS what it would remove;
 * it takes `--prune --apply` to actually delete.
 */
const PRUNE = process.argv.includes("--prune");
/**
 * Channels we refuse to delete even when pruning, because prod points at them.
 * #paper-log is the live DISCORD_WEBHOOK_URL target during the paper-logging
 * run — deleting it silently kills the daily card. Add names here before
 * repointing any webhook, not after.
 */
const PRUNE_PROTECTED = new Set(["paper-log"]);

const CHANNEL_TEXT = 0;
const CHANNEL_CATEGORY = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface DiscordRole { id: string; name: string; }
interface DiscordChannel { id: string; name: string; type: number; parent_id: string | null; }

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
  await sleep(350); // gentle global pacing under Discord's rate limits
  return (res.status === 204 ? null : await res.json()) as T;
}

function printPlan() {
  console.log("\nARCHR server plan\n=================\n");
  console.log("ROLES:");
  for (const r of SERVER_PLAN.roles) {
    console.log(`  @${r.name.padEnd(14)} ${r.hoist ? "hoisted" : "       "}  #${r.color.toString(16).padStart(6, "0")}  — ${r.note}`);
  }
  for (const cat of SERVER_PLAN.categories) {
    console.log(`\n${cat.name}   [${cat.visibility}]`);
    for (const ch of cat.channels) {
      const flags = [ch.readOnly ? "read-only" : "", ch.pinned ? `pins ${ch.pinned.length}` : ""].filter(Boolean).join(", ");
      console.log(`  #${ch.name.padEnd(20)} ${flags}`);
    }
  }
  const chCount = SERVER_PLAN.categories.reduce((n, c) => n + c.channels.length, 0);
  console.log(`\n→ ${SERVER_PLAN.roles.length} roles, ${SERVER_PLAN.categories.length} categories, ${chCount} channels.\n`);
}

async function main() {
  if (MODE === "plan") {
    printPlan();
    return;
  }
  if (!TOKEN || !GUILD) throw new Error("Set DISCORD_BOT_TOKEN and DISCORD_GUILD_ID (or use --plan).");

  const apply = MODE === "apply";
  console.log(`\nARCHR provisioner — ${apply ? "APPLY (writing)" : "DRY RUN (reads only)"}\n`);

  // Existing state (idempotency keys are names).
  const existingRoles = await api<DiscordRole[]>(`/guilds/${GUILD}/roles`);
  const existingChannels = await api<DiscordChannel[]>(`/guilds/${GUILD}/channels`);
  const roleByName = new Map(existingRoles.map((r) => [r.name, r]));
  const chanByName = new Map(existingChannels.map((c) => [`${c.type}:${c.name}`, c]));

  // 1) Roles.
  for (const r of SERVER_PLAN.roles) {
    if (roleByName.has(r.name)) {
      console.log(`  role @${r.name} — exists`);
      continue;
    }
    if (!apply) {
      console.log(`  role @${r.name} — WOULD CREATE`);
      continue;
    }
    const created = await api<DiscordRole>(`/guilds/${GUILD}/roles`, "POST", {
      name: r.name,
      color: r.color,
      hoist: r.hoist,
      permissions: "0",
    });
    roleByName.set(r.name, created);
    console.log(`  role @${r.name} — created`);
  }

  const roleId = (name: string) => roleByName.get(name)?.id ?? GUILD; // fall back to @everyone (=guild id)
  const everyoneId = GUILD;

  // 2) Categories + their channels.
  for (const cat of SERVER_PLAN.categories) {
    let parent = chanByName.get(`${CHANNEL_CATEGORY}:${cat.name}`);
    if (!parent) {
      if (!apply) {
        console.log(`\n  category ${cat.name} — WOULD CREATE`);
      } else {
        parent = await api<DiscordChannel>(`/guilds/${GUILD}/channels`, "POST", {
          name: cat.name,
          type: CHANNEL_CATEGORY,
          permission_overwrites: overwritesFor(cat.visibility, false, everyoneId, roleId),
        });
        chanByName.set(`${CHANNEL_CATEGORY}:${cat.name}`, parent);
        console.log(`\n  category ${cat.name} — created`);
      }
    } else {
      console.log(`\n  category ${cat.name} — exists`);
    }

    for (const ch of cat.channels) {
      const existing = chanByName.get(`${CHANNEL_TEXT}:${ch.name}`);
      if (existing) {
        // A channel that survived an earlier layout is in the WRONG PLACE, not
        // done: it keeps its old parent and old permissions. Skipping it (the
        // original behavior) silently left e.g. #results outside the category
        // whose visibility rules it depends on. Heal it into the plan instead.
        const needsReparent = existing.parent_id !== (parent?.id ?? null);
        if (!apply) {
          console.log(`    #${ch.name} — exists${needsReparent ? ", WOULD MOVE + relock" : ", WOULD relock"}`);
          continue;
        }
        if (parent) {
          await api(`/channels/${existing.id}`, "PATCH", {
            topic: ch.topic,
            parent_id: parent.id,
            permission_overwrites: overwritesFor(cat.visibility, Boolean(ch.readOnly), everyoneId, roleId),
          });
          console.log(`    #${ch.name} — healed (moved into ${cat.name}, permissions reapplied)`);
        }
        continue;
      }
      if (!apply) {
        console.log(`    #${ch.name} — WOULD CREATE${ch.readOnly ? " (read-only)" : ""}${ch.pinned ? " + pin" : ""}`);
        continue;
      }
      const created = await api<DiscordChannel>(`/guilds/${GUILD}/channels`, "POST", {
        name: ch.name,
        type: CHANNEL_TEXT,
        topic: ch.topic,
        parent_id: parent!.id,
        permission_overwrites: overwritesFor(cat.visibility, Boolean(ch.readOnly), everyoneId, roleId),
      });
      chanByName.set(`${CHANNEL_TEXT}:${ch.name}`, created);
      console.log(`    #${ch.name} — created`);
      await postPins(created.id, ch);
    }
  }

  // Must run BEFORE prune: Discord refuses to delete whichever channels a
  // Community server has designated as its rules/updates channels (error 50074).
  await repointCommunityChannels(chanByName, apply);

  if (PRUNE) await prune(await api<DiscordChannel[]>(`/guilds/${GUILD}/channels`), apply);

  console.log(`\n${apply ? "✓ Provisioning complete." : "Dry run complete — re-run with --apply to build."}\n`);
}

/**
 * A Community server designates one channel as its rules channel and one as its
 * moderator-updates channel, and Discord hard-refuses to delete either (API error
 * 50074) — which blocks pruning an old layout that still owns those slots.
 *
 * So repoint them at the new plan's equivalents first. Both targets are public
 * and readable by @everyone, which Discord requires of these two slots.
 *
 * A no-op on a non-Community server, which has neither slot.
 */
const COMMUNITY_RULES_CHANNEL = "welcome-and-rules";
const COMMUNITY_UPDATES_CHANNEL = "announcements";
/** Safety alerts are mod-facing, so this one points at the staff channel. */
const COMMUNITY_SAFETY_CHANNEL = "command-deck";

interface Guild {
  features: string[];
  rules_channel_id: string | null;
  public_updates_channel_id: string | null;
  safety_alerts_channel_id: string | null;
}

async function repointCommunityChannels(
  chanByName: Map<string, DiscordChannel>,
  apply: boolean
): Promise<void> {
  const guild = await api<Guild>(`/guilds/${GUILD}`);
  if (!guild.features?.includes("COMMUNITY")) return;

  const rules = chanByName.get(`${CHANNEL_TEXT}:${COMMUNITY_RULES_CHANNEL}`);
  const updates = chanByName.get(`${CHANNEL_TEXT}:${COMMUNITY_UPDATES_CHANNEL}`);
  const safety = chanByName.get(`${CHANNEL_TEXT}:${COMMUNITY_SAFETY_CHANNEL}`);

  const patch: Record<string, string> = {};
  if (rules && guild.rules_channel_id !== rules.id) patch.rules_channel_id = rules.id;
  if (updates && guild.public_updates_channel_id !== updates.id) {
    patch.public_updates_channel_id = updates.id;
  }
  if (safety && guild.safety_alerts_channel_id !== safety.id) {
    patch.safety_alerts_channel_id = safety.id;
  }
  if (!Object.keys(patch).length) return;

  if (!apply) {
    console.log(`\n  community: WOULD repoint ${Object.keys(patch).join(" + ")} to the new channels`);
    return;
  }
  await api(`/guilds/${GUILD}`, "PATCH", patch);
  console.log(`\n  community: repointed ${Object.keys(patch).join(" + ")} to the new channels`);
}

/**
 * Delete everything the plan doesn't describe — the other half of idempotency.
 * Without this, editing the plan leaves orphans behind forever and "clean up the
 * old layout" becomes manual work for a human, which is how a 25-channel room
 * survives a cut down to 13. Categories are deleted after their children so
 * Discord never re-parents an orphan to the guild root mid-run.
 */
async function prune(existing: DiscordChannel[], apply: boolean) {
  const planned = new Set<string>();
  for (const cat of SERVER_PLAN.categories) {
    planned.add(`${CHANNEL_CATEGORY}:${cat.name}`);
    for (const ch of cat.channels) planned.add(`${CHANNEL_TEXT}:${ch.name}`);
  }

  const orphans = existing.filter((c) => {
    if (planned.has(`${c.type}:${c.name}`)) return false;
    if (PRUNE_PROTECTED.has(c.name)) return false;
    return c.type === CHANNEL_TEXT || c.type === CHANNEL_CATEGORY;
  });
  // Children first, then their (now-empty) categories.
  orphans.sort((a, b) => (a.type === CHANNEL_CATEGORY ? 1 : 0) - (b.type === CHANNEL_CATEGORY ? 1 : 0));

  const failed: string[] = [];
  console.log(`\n--- prune: ${orphans.length} channel(s) not in the plan ---`);
  const skipped = existing.filter((c) => PRUNE_PROTECTED.has(c.name));
  for (const s of skipped) console.log(`  #${s.name} — PROTECTED, keeping`);
  if (!orphans.length) {
    console.log("  nothing to remove — server matches the plan.");
    return;
  }
  for (const o of orphans) {
    const kind = o.type === CHANNEL_CATEGORY ? "category" : "channel";
    if (!apply) {
      console.log(`  ${kind} ${o.name} — WOULD DELETE`);
      continue;
    }
    // Keep going on failure. Discord refuses some deletes (a Community server's
    // reserved channels, for one), and aborting the whole pass over a single
    // stubborn channel would leave the rest of the old layout standing.
    try {
      await api(`/channels/${o.id}`, "DELETE");
      console.log(`  ${kind} ${o.name} — deleted`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ${kind} ${o.name} — ✗ SKIPPED: ${msg.slice(0, 140)}`);
      failed.push(o.name);
    }
  }
  if (failed.length) {
    console.log(`\n  ⚠️ ${failed.length} could not be deleted: ${failed.join(", ")}`);
    console.log("     Usually a Community-server reserved channel — re-run after the repoint, or delete by hand.");
  }
  if (!apply) console.log("\n  (dry run — re-run with --prune --apply to actually delete)");
}

async function postPins(channelId: string, ch: ChannelPlan) {
  for (const content of ch.pinned ?? []) {
    const msg = await api<{ id: string }>(`/channels/${channelId}/messages`, "POST", { content });
    await api(`/channels/${channelId}/pins/${msg.id}`, "PUT");
    console.log(`      pinned a message in #${ch.name}`);
  }
}

main().catch((err) => {
  console.error("\n✗", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
