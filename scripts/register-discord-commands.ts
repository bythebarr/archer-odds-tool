/**
 * Registers the `/value` slash command with Discord. Run once, and again
 * whenever the command definition below changes:
 *
 *   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... DISCORD_GUILD_ID=... \
 *     npx tsx scripts/register-discord-commands.ts
 *
 * With DISCORD_GUILD_ID set it registers to that one server (instant — best for
 * a single private Discord). Without it, registers globally (can take ~1h to
 * appear). Needs the bot token only here, never at runtime.
 */

const APP_ID = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.DISCORD_GUILD_ID;

const STRING_OPTION = 3;

// Deliberately two options, not five. The old MLB-only /betcheck asked for
// market/side/line separately; matching against the board by name means the
// member just types what they'd say out loud, and it works for every sport.
const commands = [
  {
    name: "value",
    description: "Is your bet worth it? Prices any play on today's board — every sport.",
    type: 1, // CHAT_INPUT
    options: [
      {
        type: STRING_OPTION,
        name: "play",
        description: "The play — team, player, or selection (e.g. Yankees, Alcaraz, Over 8.5)",
        required: true,
      },
      {
        type: STRING_OPTION,
        name: "price",
        description: "American odds you're getting (e.g. -120 or +145)",
        required: true,
      },
    ],
  },
];

async function main() {
  if (!APP_ID || !BOT_TOKEN) {
    throw new Error("Set DISCORD_APP_ID and DISCORD_BOT_TOKEN in the environment first.");
  }

  const url = GUILD_ID
    ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
    : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

  const res = await fetch(url, {
    method: "PUT", // PUT replaces the full command set (idempotent).
    headers: {
      Authorization: `Bot ${BOT_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    throw new Error(`Discord returned ${res.status} ${res.statusText}: ${await res.text()}`);
  }

  const scope = GUILD_ID ? `guild ${GUILD_ID} (instant)` : "globally (~1h to propagate)";
  console.log(`✓ Registered ${commands.length} command(s) to ${scope}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

export {}; // module scope — keeps top-level helpers out of the global namespace
