# ARCHR Discord — operations runbook

Everything that runs the ARCHR Discord: what's live, the script that built it,
the knobs to tune, and the manual steps left before opening. Companion to
`launch-copy.md` (the paste-ready copy).

## The shape

**13 channels, 3 roles.** Cut down from 25 and then rebuilt to the owner's spec.

```
📌 IMPORTANT (public)   #welcome-and-rules · #go-premium · #announcements
🎯 FREE      (public)   #how-this-works · #free-play · #results · #tips
👑 PREMIUM   (paid)     #todays-card · #ev-slate · #value-check
👥 COMMUNITY (public)   #wins · #purchases
🛠️ STAFF     (staff)    #command-deck
```

The bar for adding a channel: **something posts to it every day, or the room is
actively asking for it.** Not "it'd be nice to have."

Premium channels are genuinely **hidden**, not "visible but locked" — Discord
shows live messages to anyone who can view a channel, so a locked-but-visible
`#ev-slate` would leak exactly what rule 4 bans. `#go-premium` names each premium
channel and its contents instead, doing the FOMO job with no leak surface.

## The three streams — the core product architecture

Everything downstream depends on this split. Don't collapse it.

| Stream | Channel | Units? | Recorded? |
| --- | --- | --- | --- |
| **card** | `#todays-card` | ✅ | ✅ the headline record |
| **free** | `#free-play` | ✅ | ✅ its own separate record |
| **slate** | `#ev-slate` | ❌ | ❌ never |

The engine finds far more +EV plays than anyone should fire at in a day. The
owner handpicks the card and the one free play in **`/deck`**; everything he
doesn't pick posts to the slate carrying no units and never touches a ledger.

`#results` posts both records as separate embeds — never summed, so the free play
can't flatter or drag the premium number. Free members see both.

## What's live

All posts sign as **Moses, Leader of Many** (the webhook username).

| Piece | Where | Trigger |
| --- | --- | --- |
| **The card** (handpicks, with units) | `postCard.ts` → `#todays-card` | card tick |
| **The free play** (one, with units) | same poster → `#free-play` | same tick |
| **The slate** (everything unpicked, no units) | same poster → `#ev-slate` | same tick |
| **Results** (both ledgers, streak/last-10) | `postResults.ts` → `#results` | results tick |

### Timing is event-driven, not clock-driven

A fixed time is a baseball assumption. Instead:

- **The card posts 3 hours before the day's FIRST event**, whatever sport that
  is. A 1pm ET tennis match pulls the card to 10am; a 10pm UFC main card pushes
  it to 7pm. `LEAD_HOURS` in `src/lib/discord/schedule.ts`.
- **Results post the moment the day's LAST tracked play settles** — not on a
  morning timer.

Vercel crons are fixed-schedule, so both are **ticks** (`post-discord` every 15m,
`post-results` every 30m) that usually do nothing and ask "is it time yet?"
Idempotency comes from a PollLog marker keyed by ET date, written only after a
webhook actually resolves.

Two deliberate behaviors worth knowing before you debug them:
- **A missed tick posts LATE, it does not skip the day.** There's no cutoff — a
  late card is recoverable, a missing one looks like a dead room.
- **The recap waits for every tracked play to settle.** A partial record on the
  trust channel is worse than a late one. Voided plays count as settled, so an
  unsupported sport can't hold a recap hostage.

### Every sport, only when it's on

No sport is special in the poster any more — section chrome (icon, label, accent,
link) derives from each adapter's own `meta`, and **a sport with no plays renders
nothing**. That's why a quiet baseball day no longer posts an empty MLB card and
UFC is simply absent the six days a week it isn't on. Event-timed surfacing falls
out of the data, not a per-sport rule.

Preview all three streams (no posting) at **`/preview/discord`**; make the picks
at **`/deck`**. Both behind the site password.

## Env vars

**Production (Vercel, `archr2` scope):**
- `DISCORD_WEBHOOK_URL` — `#todays-card` (today: `#paper-log`). **Unset = the whole drop is dormant.**
- `DISCORD_FREE_WEBHOOK_URL` — `#free-play`. Unset = the free play is skipped, the rest still posts.
- `DISCORD_SLATE_WEBHOOK_URL` — `#ev-slate`. Unset = the slate is skipped, the rest still posts.
- `DISCORD_RESULTS_WEBHOOK_URL` — `#results`. **Unset = dormant.**
- `CRON_SECRET` — also gates `/deck` (`?token=…`) and `/api/admin/*`.
- `SITE_ACCESS_PASSWORD` — Basic Auth gate on the whole site (`/api/*` is exempt so Discord + crons work).

Each channel is independently dormant, so the room can be brought up one surface
at a time.

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

# Build/repair the server (roles, categories, channels, locks, pins):
DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/discord/provision-server.ts --apply

# Reconcile DOWN too — report, then delete, anything not in the plan:
DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/discord/provision-server.ts --prune
DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/discord/provision-server.ts --prune --apply
```

The whole server spec — roles, channels, locks, and every pinned message — lives
in `scripts/discord/serverPlan.ts`. Edit it, re-run the script; it fills gaps and
never duplicates. A test pins every `pinned` entry under Discord's 2000-char cap,
so an over-long pin fails in CI rather than mid-provision.

Names are the idempotency key, so **renaming in the plan creates a second
channel** rather than renaming the existing one — rename in Discord too, or prune.

`--prune` deletes what the plan doesn't describe. It skips `PRUNE_PROTECTED`
(`#paper-log`, prod's live webhook target) and never touches **roles**, which
carry member and Whop assignments — an accidental role delete is unrecoverable in
a way a channel isn't.

## The daily operation

1. Open **`/deck?token=<CRON_SECRET>`** (works on a phone — plain forms, no JS).
2. Every +EV play the system found is listed with model EV, market EV, price,
   best book, suggested units, and start time.
3. Tap **👑 Card** on the plays you'd stake, **🎯 Free** on the one that goes out
   free. Tap nothing and no card posts — "no card is a card".
4. The tick does the rest.

Selections are stored as intent (`CardSelection`), not results: tick and un-tick
all morning while prices move. Nothing is recorded until the poster fires, and it
records the price that actually posted. A pick whose line vanishes before post
time is skipped with a warning rather than posted at a stale number.

## Tuning knobs

- **`LEAD_HOURS`** — `schedule.ts` (3): how far ahead of the first event the card drops.
- **Staking** — `@/lib/betting/kelly` (quarter-Kelly, per-price cap).
- **UFC leans** — `ufcBestPlays.ts`: `MIN_CONFIDENCE` (0.60), `MAX_UFC_PLAYS` (6), `LOOKAHEAD_DAYS` (3).

## Left to do (manual)

1. **Run the provisioner** (`--apply`) to build the layout, then `--prune --apply`
   to remove leftovers from the old 25-channel version.
2. **Whop** — connect Discord in the Whop dashboard and map the product to the
   **@Premium** role (auto-assign on payment, strip on cancel). Paste the checkout
   link into the `#go-premium` pin (it currently says `[Checkout link goes here]`).
3. **Go live** — create webhooks on `#todays-card`, `#free-play`, `#ev-slate`, and
   `#results`, and set the four env vars. Repoint `DISCORD_WEBHOOK_URL` off
   `#paper-log` when the paper-logging run ends.
4. **Wipe the ledger** at cutover — the paper-log rows are pre-split history.

## Deferred follow-ups

- **`#value-check`** — the ask-the-bot EV lookup. Channel exists, bot doesn't yet.
- **`#tips`** — no poster yet; the old rotating-lesson content was cut and needs rebuilding into its own channel.
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
