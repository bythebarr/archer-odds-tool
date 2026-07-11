# ARCHR Discord — operations runbook

Everything that runs the ARCHR Discord: what's live, the scripts that built it,
the knobs to tune, and the manual steps left before opening. Companion to
`launch-copy.md` (the paste-ready copy) and the server blueprint artifact.

## What's live

All posts sign as **Moses, Leader of Many** (the webhook username). Moses's day, in order:

| Piece | Where | Trigger |
| --- | --- | --- |
| **☀️ Morning slate drop** (today's board + fight-week flag) | `src/lib/discord/mosesDaily.ts` `postMorningDrop` | `post-morning` cron, 13:00 UTC / 9am ET |
| **📚 Moses 101** (rotating glossary lesson) | `src/lib/discord/mosesDaily.ts` `postTeachingDrop` | `post-teaching` cron, 15:30 UTC / 11:30am ET |
| **#results grader** (recap + streak/last-10) | `src/lib/discord/postResults.ts` → `#results` | `post-results` cron, 15:00 UTC / 11am ET |
| **Archer's Best Plays** (MLB model +EV card) | `src/lib/discord/postCard.ts` → `#full-card` (currently `#paper-log`) | `post-discord` cron, 17:00 UTC / 1pm ET |
| **Free lean** (funnel tease) | same poster → `#todays-lean` | same cron (needs `DISCORD_FREE_WEBHOOK_URL`) |
| **UFC fighter-math leans** | `src/lib/discord/ufcBestPlays.ts` → `#fight-night` | same poster, on fight weeks (3-day lookahead) |
| **/betcheck** (ML · spread · total value grader) | `src/app/api/discord/interactions/route.ts` | slash command in the server |

Preview the whole daily cadence (no posting) at **`/preview/discord`** — behind the site password.

## Env vars

**Production (Vercel, `archr2` scope):**
- `DISCORD_WEBHOOK_URL` — the premium card channel (today: `#paper-log`; repoint to `#full-card` at launch).
- `DISCORD_RESULTS_WEBHOOK_URL` — the results recap channel.
- `DISCORD_MOSES_WEBHOOK_URL` — Moses's daily rhythm (morning drop + Moses 101). **Unset = both dormant.** Point it at the room's main channel to light them up. Crons are already scheduled; they no-op until this is set.
- `DISCORD_FREE_WEBHOOK_URL` — optional free-lean channel.
- `DISCORD_PUBLIC_KEY` — verifies `/betcheck` interaction signatures. Unset = command endpoint returns 503 (dormant).
- `SITE_ACCESS_PASSWORD` — Basic Auth gate on the whole site (`/api/*` is exempt so Discord + crons work).

**Local only (for the ops scripts below — never stored in prod):**
- `DISCORD_BOT_TOKEN` — the bot token. Used to provision/seed/register.
- `DISCORD_GUILD_ID` — the server id.
- `DISCORD_APP_ID` — the application id (command registration only).

## The scripts

All idempotent and safe to re-run. Run from repo root.

```bash
# Preview the whole server structure (no token needed):
npx tsx scripts/discord/provision-server.ts --plan

# Build/repair the server (roles, categories, channels, locks, pinned rules):
DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/discord/provision-server.ts --apply

# Seed welcome/how-to content into the bare channels (skips any with pins):
DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/discord/seed-content.ts

# Elevate to a Community server — icon, Community mode, Welcome Screen, Onboarding,
# :archr: emoji, Hall of Cashes forum, Fight Night event (idempotent, safe to re-run):
DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/discord/pro-upgrade.ts

# Register (or update) the /betcheck slash command to the server:
DISCORD_APP_ID=… DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/register-discord-commands.ts
```

The server spec lives in `scripts/discord/serverPlan.ts` (roles/channels/locks) and
`scripts/discord/channelContent.ts` (pinned copy). Edit those, re-run the scripts —
they fill gaps, never duplicate.

## Tuning knobs

- **Best Plays band** — `postCard.ts`: `MIN_ARCHER_EV` (0.03), `MAX_ARCHER_EV` (0.20, drops miscalibrated extremes), `MAX_PLAYS` (8).
- **UFC leans** — `ufcBestPlays.ts`: `MIN_CONFIDENCE` (0.60), `MAX_UFC_PLAYS` (6), `LOOKAHEAD_DAYS` (3).
- **Bet Check verdict bands** — `betCheck.ts`: `SHARP_EV` (+0.02), `POOR_EV` (−0.02).

## Left to do (manual)

1. **Whop** — in the Whop dashboard, connect Discord and map the product to the
   **@Premium** role (auto-assign on payment, strip on cancel). Put the checkout
   link in `#get-access`.
2. **Verify + welcome bot** — add **Carl-bot** or **MEE6** for the ✅ rules-gate
   (→ `@Verified`) and member greetings. Our ARCHR bot is HTTP-interactions only
   (no persistent gateway), so it can't listen for reactions/joins — this is the
   standard split, not a gap in the build. Until this exists, the `👥 COMMUNITY`
   category is visible to `@Verified`/staff only.
3. **Go live** — after ~2 weeks of private paper-logging, create a webhook on
   `#full-card` and repoint `DISCORD_WEBHOOK_URL` from `#paper-log` → `#full-card`.
   Seed the first 20 founders ($15/life), then flip to $25/mo once the room's alive.

## Deferred follow-ups

- Grade UFC leans (a win-rate ledger — they post but aren't recorded/graded yet).
- Exact alt-line grading in `/betcheck` (currently grades at the main line).
- Automated leaderboard → `@Tail Captain`.
- Market-EV coverage for tennis/soccer in the card.
