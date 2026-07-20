# ARCHR Discord — operations runbook

Everything that runs the ARCHR Discord: what's live, the script that built it,
the knobs to tune, and the manual steps left before opening. Companion to
`launch-copy.md` (the paste-ready copy).

## The shape

Deliberately small: **6 channels, 3 roles, 2 posts a day.** The room was cut down
from 25 channels / 4 daily posts because a room with more surfaces than content
reads as dead. One play surface, one record, one place to talk.

```
🟢 START HERE   (public)   #start-here · #announcements
👑 THE CARD     (premium)  #todays-card · #results · #chat
🛠️ STAFF        (staff)    #command-deck
```

The bar for adding a channel back: **something posts to it every day, or the
room is actively asking for it.** Not "it'd be nice to have."

## What's live

Both posts sign as **Moses, Leader of Many** (the webhook username).

| Piece | Where | Trigger |
| --- | --- | --- |
| **Archer's Best Plays** (the card — model +EV game lines + props, every positive play) | `src/lib/discord/postCard.ts` → `#todays-card` | `post-discord` cron, 14:30 UTC / 10:30am ET (early, to beat first pitch) |
| **UFC fighter-math leans** | `src/lib/discord/ufcBestPlays.ts` → a second embed on the same post | same poster, on fight weeks (3-day lookahead) |
| **#results grader** (recap + streak/last-10) | `src/lib/discord/postResults.ts` → `#results` | `post-results` cron, 15:00 UTC / 11am ET |

There is **no free lean and no second board** — the card is the only play surface.

Preview the card (no posting) at **`/preview/discord`** — behind the site password.

## Env vars

**Production (Vercel, `archr2` scope):**
- `DISCORD_WEBHOOK_URL` — the card channel (today: `#paper-log`; repoint to `#todays-card` at launch). **Unset = the card is dormant.**
- `DISCORD_RESULTS_WEBHOOK_URL` — the results recap channel. **Unset = dormant.**
- `SITE_ACCESS_PASSWORD` — Basic Auth gate on the whole site (`/api/*` is exempt so Discord + crons work).

**Local only (for the ops script below — never stored in prod):**
- `DISCORD_BOT_TOKEN` — the bot token.
- `DISCORD_GUILD_ID` — the server id.

## The script

Idempotent and safe to re-run. Run from repo root.

```bash
# Preview the whole server structure (no token needed):
npx tsx scripts/discord/provision-server.ts --plan

# Dry run against the real server (reads only, shows the diff):
DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/discord/provision-server.ts

# Build/repair the server (roles, categories, channels, locks, the pinned #start-here):
DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/discord/provision-server.ts --apply
```

The whole server spec — roles, channels, locks, and the pinned welcome/rules/
disclaimer copy — lives in `scripts/discord/serverPlan.ts`. Edit it, re-run the
script; it fills gaps and never duplicates.

⚠️ The provisioner matches by **name** and only *creates what's missing* — it does
not delete. Channels from the old 25-channel layout that already exist on the
server have to be deleted by hand in Discord.

## Tuning knobs

- **Best Plays band** — `postCard.ts`: the card posts EVERY positive-EV play; conviction shows in the stake, not a filter. Staking is `@/lib/betting/kelly` (quarter-Kelly, per-price cap).
- **UFC leans** — `ufcBestPlays.ts`: `MIN_CONFIDENCE` (0.60), `MAX_UFC_PLAYS` (6), `LOOKAHEAD_DAYS` (3).

## Left to do (manual)

1. **Delete the old channels** — the provisioner won't. Remove anything not in
   the 6-channel spine above.
2. **Whop** — connect Discord in the Whop dashboard and map the product to the
   **@Premium** role (auto-assign on payment, strip on cancel). The checkout link
   goes in `#start-here` (there's no `#get-access` channel any more).
3. **Go live** — after the private paper-logging run, create a webhook on
   `#todays-card` and repoint `DISCORD_WEBHOOK_URL` from `#paper-log` → `#todays-card`.

## Deferred follow-ups

- Grade UFC leans (a win-rate ledger — they post but aren't recorded/graded yet).
- Market-EV coverage for tennis/soccer in the card.

## Cut (2026-07-20) — deliberately, not lost

Removed because the room was doing too much before it had a single member. All of
it is in git history if it earns its way back:

- **Channels:** `#rules`, `#disclaimer` (folded into `#start-here`), `#todays-lean`,
  `#get-access`, `#general`, `#todays-board`, `#tracked-plays`, `#fight-night`,
  `#bet-check`, `#by-sport`, `#tail-chat`, `#member-plays`, `#bankroll-101`,
  `#leaderboard`, `#wins`, `#introductions`, `#sports-talk`, `#support`,
  `#responsible-gaming`, `#mod-log`, `#staff-chat`.
- **Roles:** `@Founders`, `@Tail Captain`, `@Verified`.
- **Daily posts:** the morning slate drop (`post-morning`) and Moses 101
  (`post-teaching`) crons + `mosesDaily.ts`; the free-lean tease and the whole
  `freeLean` display field through the engine.
- **Commands:** `/betcheck` + `betCheck.ts` + the interactions endpoint +
  `register-discord-commands.ts`.
- **Scripts:** `seed-content.ts`, `channelContent.ts`, `pro-upgrade.ts`
  (Community mode, Welcome Screen, Onboarding, forum, recurring event).
- **Admin:** the `fire-morning` bookmark route.
