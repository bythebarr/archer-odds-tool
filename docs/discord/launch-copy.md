# ARCHR — Discord launch copy pack

Ready-to-paste copy for the paid Discord. Brand voice: the community is **ARCHR**;
picks come from **Archer** (the analyst persona). Everything sells *disciplined
+EV research with a public record* — process, not promises. Adjust names/prices
to taste before pasting.

---

## 1. Server + channel structure

Six channels, no more. The source of truth is `scripts/discord/serverPlan.ts` —
if this list and that file disagree, the file wins.

**🟢 START HERE (public)**
- `#start-here` — the pitch + how the room works + rules + disclaimer + join link (Whop)
- `#announcements` — server news and launch drops

**👑 THE CARD (Whop-gated @Premium)**
- `#todays-card` — the whole daily card: every play, the number, the best book (auto-posted)
- `#results` — running W/L + unit record, updated daily. **Never delete a loss.**
- `#chat` — talk through the card

**🛠️ STAFF**
- `#command-deck` — your cockpit, invisible to members

---

## 2. `#start-here` (the pitch)

> **ARCHR — every-sport +EV, one board.**
>
> This isn't a "locks" room. Archer runs a model across MLB, UFC, F1, tennis and
> soccer — pricing every play against the market and surfacing where the number
> is actually in your favor. You get the plays, the EV, and the best book to get
> them at. We track every pick in units, in the open, wins and losses.
>
> **Inside you get:** the complete daily card, EV on every play, best-price line
> shopping across books, prop plays, and a public record you can audit.
>
> 👉 **Start a 3-day free trial:** [Whop link]
>
> _Research & entertainment only. Not betting advice. 21+. If you or someone you
> know has a gambling problem, call or text 1-800-522-4700._

---

## 3. `#rules`

> **1. 21+ (or legal age in your jurisdiction).** By being here you confirm you are.
> **2. This is research, not advice.** Every play is our opinion. You are
>     responsible for your own action. No outcome is guaranteed.
> **3. Units, never dollars.** Plays are staked in units (1u = your standard bet).
>     We never tell you how much money to wager. Bet within your bankroll.
> **4. No spamming, touting other services, or DMs selling picks.** Instant ban.
> **5. Be decent.** No harassment, no bigotry, no scam links.
> **6. Wins and losses both get posted.** We don't hide a bad day and neither should you.
> **7. Gamble responsibly.** If it stops being fun, step away. 1-800-522-4700.

---

## 4. `#disclaimer` (pin it)

> **ARCHR provides sports information and analysis for research and entertainment
> purposes only. Nothing here is betting, financial, or investment advice.**
>
> - We do not accept, place, or handle bets or funds of any kind. We are not a
>   sportsbook or a betting operator.
> - Odds, model projections, hit-rates, and EV figures are estimates, may be
>   inaccurate or stale, and carry no warranty. Past performance does not predict
>   future results.
> - You alone are responsible for your betting decisions and for complying with
>   the laws of your jurisdiction. Must be 21+ (or legal age where you are).
> - Gambling can be addictive. If you or someone you know has a problem, call or
>   text the National Problem Gambling Helpline: **1-800-522-4700**.
>
> _[If you ever add sportsbook referral links: "ARCHR may earn a commission from
> links to sportsbooks. This never changes the plays we post."]_

---

## 5. Whop product description

> **ARCHR — +EV plays across every sport, with a model behind them.**
>
> Get Archer's full daily card: every play that clears our +EV threshold, the
> exact number, and the best book to get it at — across MLB, UFC, F1, tennis and
> soccer. Plus prop plays, line-move alerts, a public unit-tracked record, and a
> community that bets with discipline, not vibes.
>
> ✅ Full daily +EV card
> ✅ EV + best-price line shopping on every play
> ✅ Prop plays & line-move alerts
> ✅ Transparent unit record — wins and losses
> ✅ Community + bankroll education
>
> **3-day free trial. Cancel anytime.**
>
> _Research/entertainment only · not betting advice · 21+ · 1-800-522-4700_

**Suggested tiers (set in Whop):**
- Monthly — **$25/mo**
- Quarterly — **$60** (save 20%)
- Founders — **first 20 members $15/mo locked for life** (seed the room)
- Free trial — **3 days**

---

## 6. Whop → Discord wiring (no code)

1. Whop → create a **Product** (the membership) → add the tiers above.
2. Product → **Integrations → Discord** → connect your server, map the paid role
   to the premium tier. Whop auto-assigns on payment, auto-removes on cancel.
3. Enable the **3-day free trial** on the product.
4. Drop the checkout link into `#start-here`.

---

## 7. How the auto-poster connects (for you, not members)

The tool posts the card itself — you don't copy/paste plays daily:
- Create a **webhook** on `#todays-card` → set it as `DISCORD_WEBHOOK_URL`.
- Create a **webhook** on `#results` → set it as `DISCORD_RESULTS_WEBHOOK_URL`.
- The `post-discord` cron fires daily (14:30 UTC / 10:30am ET, right after the
  morning odds poll) and posts the card — early enough to land before first pitch
  on day slates. `post-results` follows at 15:00 UTC / 11am ET with the graded
  recap. No webhook set = nothing posts.
- That's the whole cadence: **two posts a day.** There is no free lean.

---

## 8. Launch checklist

- [ ] Run the provisioner (`--apply`) to build the 6 channels + 3 roles + the `#start-here` pin
- [ ] Delete any leftover channels from the old layout (the provisioner won't)
- [ ] Whop product + Discord connect + 3-day trial
- [ ] **Paper-log 1–2 weeks of picks first** so `#results` launches with a record
- [ ] Add the `#todays-card` webhook → `DISCORD_WEBHOOK_URL` (prod env)
- [ ] Add the `#results` webhook → `DISCORD_RESULTS_WEBHOOK_URL` (prod env)
- [ ] Open Founders tier to your network / one relevant community
- [ ] Post daily, religiously — never hide a loss
- [ ] Flip Founders → standard $25 once the room feels alive
