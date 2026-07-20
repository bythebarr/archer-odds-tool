# ARCHR Discord — launch checklist

Step by step, in order. **Nothing posts to the room until Phase 5**, so Phases 0–4
are all safe to do whenever.

Anything in `code` is a command to run in the terminal. Prefix it with `! ` in
Claude Code to run it in the session (`! npx tsx ...`) so the output lands in the
conversation.

---

## Phase 0 — collect four values (~10 min, one time)

Everything else needs these. Keep them in a scratch note; three of them never go
into the repo or prod.

Go to <https://discord.com/developers/applications> and open your app (or hit
**New Application** if there isn't one).

| Value | Where |
| --- | --- |
| `DISCORD_APP_ID` | **General Information** → *Application ID* |
| `DISCORD_PUBLIC_KEY` | **General Information** → *Public Key* |
| `DISCORD_BOT_TOKEN` | **Bot** → *Reset Token* → copy (shown once) |
| `DISCORD_GUILD_ID` | In Discord: User Settings → Advanced → **Developer Mode ON**, then right-click the server → *Copy Server ID* |

**Then invite the bot to the server** (skip if it's already in there):

**OAuth2 → URL Generator** → tick scopes `bot` and `applications.commands` → under
Bot Permissions tick **Administrator** → open the generated URL at the bottom →
pick your server → Authorize.

> Administrator is the simple option. The bot genuinely needs Manage Roles,
> Manage Channels, and Manage Webhooks; Administrator covers all three without
> fiddling.

---

## Phase 1 — build the server (~5 min)

**1a. Look at the plan first.** No token needed, changes nothing:

```bash
npx tsx scripts/discord/provision-server.ts --plan
```

You should see 3 roles, 5 categories, 13 channels.

**1b. Dry run against the real server.** Reads only, shows what it *would* do:

```bash
DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/discord/provision-server.ts
```

**1c. Build it:**

```bash
DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/discord/provision-server.ts --apply
```

Creates the roles, categories, channels, permission locks, and posts + pins the
welcome/rules/go-premium/orientation copy. Safe to re-run — it only creates
what's missing.

**1d. See what's left over from the old layout.** ⚠️ Read this list before the
next step:

```bash
DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/discord/provision-server.ts --prune
```

This only *reports*. `#paper-log` is protected and won't be touched, and roles are
never pruned. **If anything on that list is something you want to keep, tell me
and I'll add it to `PRUNE_PROTECTED` before you run 1e.**

**1e. Delete the leftovers:**

```bash
DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/discord/provision-server.ts --prune --apply
```

---

## Phase 2 — look at it and tell me what's wrong

Open the server and read it as a new member would. Specifically:

- [ ] `#welcome-and-rules` — does the pitch sound like you? This is the one that
      has to land: it's carrying the whole "self-built quant system, not a tout"
      story.
- [ ] `#go-premium` — the pricing and what's-included list. **It still says
      `[Checkout link goes here]`** — that's Phase 6.
- [ ] `#how-this-works` — the orientation. Does the card-vs-slate explanation
      make sense?
- [ ] Channel names, order, emoji.

Tell me anything that's off and I'll change the copy and re-run. **Nothing is
live yet**, so this is free to iterate on.

---

## Phase 3 — ship the code

Everything is on the `sport-engine-phase0` branch and not deployed yet.

- [ ] Say the word and I'll open the PR to `main`
- [ ] Merge it
- [ ] **Verify the deploy actually landed** — GitHub → Vercel auto-deploy has been
      unreliable here, so check the Vercel dashboard rather than assuming

The migration (`PlayStream` + `CardSelection`) runs automatically on deploy via
`prisma migrate deploy` in the build command.

---

## Phase 4 — try the deck (still nothing posts)

- [ ] Open `https://<your-domain>/deck?token=<CRON_SECRET>` on your phone
- [ ] Tick a couple of plays as 👑 Card, one as 🎯 Free
- [ ] Open `https://<your-domain>/preview/discord` — this renders **exactly** what
      would post: the welcome line, your card, the free play, the slate

Iterate here until the card looks right. Nothing leaves the app.

---

## Phase 5 — go live (only when you're happy)

**5a. Create five webhooks.** For each channel: right-click channel → **Edit
Channel** → **Integrations** → **Webhooks** → **New Webhook** → **Copy Webhook
URL**.

| Channel | Env var |
| --- | --- |
| `#todays-card` | `DISCORD_WEBHOOK_URL` |
| `#free-play` | `DISCORD_FREE_WEBHOOK_URL` |
| `#ev-slate` | `DISCORD_SLATE_WEBHOOK_URL` |
| `#results` | `DISCORD_RESULTS_WEBHOOK_URL` |
| `#tips` | `DISCORD_TIPS_WEBHOOK_URL` |

**5b. Set them in Vercel** → Project → Settings → Environment Variables →
Production. Also add `DISCORD_PUBLIC_KEY` from Phase 0.

> Each one is independent. Set only `DISCORD_TIPS_WEBHOOK_URL` first if you want
> to watch a single harmless post land before turning on the rest.

**5c. Redeploy** so the new env vars are picked up.

**5d. Turn on `/value`:**

```bash
DISCORD_APP_ID=… DISCORD_BOT_TOKEN=… DISCORD_GUILD_ID=… npx tsx scripts/register-discord-commands.ts
```

Then Developer Portal → **General Information** → **Interactions Endpoint URL** →
`https://<your-domain>/api/discord/interactions` → Save. Discord will ping it to
verify; it must save green. (It'll fail if `DISCORD_PUBLIC_KEY` isn't set in prod
yet — do 5b first.)

**5e. Wipe the ledger.** The paper-log rows are pre-split history and would
pollute the launch record. Tell me when you're at this point and I'll do it —
it's destructive, so I won't run it unattended.

---

## Phase 6 — Whop (money)

- [ ] Create the product + tiers in Whop
- [ ] Whop → Integrations → **Discord** → connect the server, map the paid tier to
      the **@Premium** role (auto-assigns on payment, strips on cancel)
- [ ] Enable the free trial if you want one
- [ ] Copy the checkout link → tell me and I'll paste it into the `#go-premium`
      pin and re-run the provisioner

---

## Phase 7 — before you invite anyone

- [ ] Post the card for a few days and confirm `#results` grades it correctly
- [ ] Check the Vercel cron usage — the ticks run every 15/30 min, which is a lot
      more invocations than the old fixed schedule. Dial back if your plan
      complains.
- [ ] Confirm a second account (no @Premium) genuinely cannot see `#todays-card`,
      `#ev-slate`, or `#value-check`

---

## What I can't do

For the record, so you're not waiting on me for these:

- **Anything touching the real Discord** — I don't have the bot token, and it's
  local-only by design. Every provisioner and command-registration run is yours.
- **Production** — your Vercel env vars are marked Sensitive, so `vercel env pull`
  returns blanks. I can't read the prod DB or fire prod crons.
- **Whop** — entirely your dashboard.

Everything else is mine.
