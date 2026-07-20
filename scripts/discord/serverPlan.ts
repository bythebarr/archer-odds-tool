/**
 * The ARCHR server, as data — the single source of truth the provisioner reads
 * to erect the whole Discord (see provision-server.ts) and the shape the
 * blueprint describes. Pure and dependency-free so it can be unit-tested and
 * diffed like any spec. Edit here, re-run the provisioner; it's idempotent.
 */

/** Discord permission bits we use, as strings (Discord wants bitfield strings). */
export const PERM = {
  VIEW_CHANNEL: "1024", // 1 << 10
  SEND_MESSAGES: "2048", // 1 << 11
} as const;

/** Who can see a category/channel. The provisioner turns this into overwrites. */
export type Visibility =
  | "public" // @everyone can see (the door: what this is + how to get in)
  | "premium" // @Premium role only (the card, the record, the room)
  | "staff"; // @Mod / @Archer only

export interface RolePlan {
  name: string;
  /** Hex color as an int (0 = default). */
  color: number;
  /** Show separately in the member list. */
  hoist: boolean;
  /** Purpose note — documentation only, not sent to Discord. */
  note: string;
}

export interface ChannelPlan {
  name: string;
  topic: string;
  /** Only staff/bots can post (announcements, rules, auto-fed feeds). */
  readOnly?: boolean;
  /** Message(s) to post and pin on first creation (welcome/rules/disclaimer). */
  pinned?: string[];
  /**
   * Former names for this channel. Names are the idempotency key, so without
   * this a rename in the plan would CREATE a second channel and orphan the
   * original (losing its history and any webhook pointed at it). Listed here,
   * the provisioner finds the old one and renames it in place instead.
   */
  aliases?: string[];
  /**
   * Images only — an AutoMod rule blocks any message carrying text. A photo with
   * no caption posts fine; a caption is refused before it ever appears, which is
   * stricter (and cleaner) than deleting it afterwards.
   *
   * This is also a leak control, not just tidiness: #hall-of-cashes is public,
   * so a member typing out the pick behind their slip would expose a premium
   * play to free members. Staff roles are exempt.
   */
  imageOnly?: boolean;
}

export interface CategoryPlan {
  name: string;
  visibility: Visibility;
  channels: ChannelPlan[];
}

export interface ServerPlan {
  roles: RolePlan[];
  categories: CategoryPlan[];
}

// --- permission-overwrite logic (pure, kept out of the IO script so it's testable) ---

// Small bitfields (1024 | 2048), so plain Number OR is exact and safe here.
const VIEW = Number(PERM.VIEW_CHANNEL);
const SEND = Number(PERM.SEND_MESSAGES);

/** Which roles can VIEW a category of this visibility (besides the deny on @everyone). */
export function viewersFor(v: Visibility): string[] {
  if (v === "premium") return ["Premium", "Mod", "Archer"];
  if (v === "staff") return ["Mod", "Archer"];
  return []; // public — no gate
}

/**
 * Build a channel's permission_overwrites from its category visibility + readOnly.
 * Accumulates allow/deny per target so the view-gate and the post-lock compose
 * cleanly instead of clobbering each other. `roleId` maps a role name to its
 * Discord id; `everyoneId` is the guild id (the @everyone role).
 */
export function overwritesFor(
  visibility: Visibility,
  readOnly: boolean,
  everyoneId: string,
  roleId: (name: string) => string
): Array<{ id: string; type: number; allow: string; deny: string }> {
  const acc = new Map<string, { allow: number; deny: number }>();
  const bump = (id: string, allow = 0, deny = 0) => {
    const cur = acc.get(id) ?? { allow: 0, deny: 0 };
    acc.set(id, { allow: cur.allow | allow, deny: cur.deny | deny });
  };

  if (visibility !== "public") {
    bump(everyoneId, 0, VIEW); // hide from everyone
    for (const r of viewersFor(visibility)) bump(roleId(r), VIEW, 0);
  }
  if (readOnly) {
    bump(everyoneId, 0, SEND); // no one posts...
    bump(roleId("Mod"), SEND, 0); // ...except staff (bots/webhooks bypass via Admin)
    bump(roleId("Archer"), SEND, 0);
  }

  return [...acc].map(([id, { allow, deny }]) => ({ id, type: 0, allow: allow.toString(), deny: deny.toString() }));
}

// ARCHR greens + accents (ints).
const GREEN = 0x06996b;
const BRIGHT_GREEN = 0x2fd996;
const MOD_BLUE = 0x4a6cf0;

// --- pinned copy -------------------------------------------------------------
// Each entry in a `pinned` array is ONE Discord message (hard cap 2000 chars),
// posted and pinned in order on channel creation.

/**
 * The pitch. The differentiator carries the whole room: these are self-built
 * quant tools that generate their OWN model EV *and* shop the market for
 * mispriced numbers — not a tout reselling somebody's opinion. That claim leads,
 * everything else supports it.
 */
const WELCOME_PITCH = [
  "# 🏹 ARCHR — this is not a picks room.",
  "",
  "Every paid Discord you've been in sells you the same thing: a guy's opinion, a screenshot of his wins, and no way to check any of it.",
  "",
  "**This is a system.** I built the tools behind this room myself — a quant stack that ingests every game, every price, every book, across every sport, and prices it independently of the market.",
  "",
  "That gets you two edges most rooms can't touch:",
  "",
  "🧠 **Model EV** — my own projections generate a fair price for a play. When my number and the market's number disagree badly enough, that's an edge the book is giving away. Almost nobody selling picks has this. It's the hard part.",
  "",
  "📊 **Market EV** — I shop every book at once and surface where a line is simply mispriced against the field. Same play, better number, more money.",
  "",
  "Most rooms are limited to one of those, if that. You get both, side by side, on every play — plus the best book to actually get the number at.",
  "",
  "**And the record is public.** Units on every tracked play, wins *and* losses, never deleted. If the system has a bad week you'll see the bad week. That's the point — a record you can audit is the only thing that separates this from the noise.",
  "",
  "👉 **Read the rules below, then head to #🔓-go-premium.**",
].join("\n");

const WELCOME_RULES = [
  "# 📋 House rules",
  "",
  "**1. 21+.** By being here you confirm you're of legal betting age in your jurisdiction.",
  "**2. Research, not advice.** Every play is analysis and opinion. You own your action. No outcome is guaranteed.",
  "**3. Units, never dollars.** Plays are staked in units (1u = your standard bet). We never tell you how much money to wager.",
  "**4. Never leak premium plays.** Posting, screenshotting, relaying, or DMing premium picks to anyone outside premium = **instant permanent ban**, no refund. This is the one rule with no second chance.",
  "**5. Slips only after they settle.** Post your wins in #🏆-hall-of-cashes once the play is graded — never before. A live slip is a leaked pick.",
  "**6. No touting or DM-selling.** Selling picks, shilling other services, or DMing members to sell = instant ban.",
  "**7. Be decent.** No harassment, bigotry, or scam links.",
  "**8. Wins and losses both get posted.** I never hide a bad day, and neither should you.",
  "**9. Gamble responsibly.** If it stops being fun, step away. 1-800-522-4700.",
  "",
  "## The fine print",
  "**ARCHR provides sports information and analysis for research and entertainment only. Nothing here is betting, financial, or investment advice.**",
  "• We do not accept, place, or handle bets or funds. We are not a sportsbook or betting operator.",
  "• Odds, model projections, hit-rates, and EV figures are estimates, may be inaccurate or stale, and carry no warranty. Past performance does not predict future results.",
  "• You alone are responsible for your betting decisions and for complying with the laws of your jurisdiction.",
  "• Gambling can be addictive. If you or someone you know has a problem, call or text the National Problem Gambling Helpline: **1-800-522-4700**.",
].join("\n");

/**
 * The paywall pitch. Also does the FOMO job that "visible but locked" channels
 * would do unsafely — it names each premium channel and what's inside, so the
 * free member knows exactly what they're missing without any leak surface.
 */
const GO_PREMIUM = [
  "# 🔓 What premium actually gets you",
  "",
  "**Free members get:** one handpicked play a day (#🎁-free-play), the full public record for both free and premium plays (#📊-the-ledger), and the daily tips (#📚-sharp-school).",
  "",
  "**Premium unlocks three channels:**",
  "",
  "**👑 #👑-todays-card** — my handpicked plays for the day, with units on every one. This is the card the tracked record is built on. Posted ~3 hours before the day's first event, every day, across whatever sports are actually running.",
  "",
  "**📊 #📈-the-firehose** — the firehose. *Every* positive-EV play my system finds that day, all sports, all markets, with both the model EV and the market EV on each one, plus the best book. No units — this is the full board to judge for yourself. Most days this is far more plays than any room hands out.",
  "",
  "**🤖 #🤖-value-check** — ask the bot about any play you're looking at, in any sport. It runs the same numbers and tells you whether the price you're getting is worth it. Not just my plays — *yours*.",
  "",
  "## How to join",
  "",
  "**1.** Hit the link below.",
  "**2.** Pick a plan and check out — takes about a minute.",
  "**3.** Connect your Discord when prompted. Your **@Premium** role is assigned automatically, usually within seconds.",
  "**4.** The three channels above appear in your sidebar. That's it.",
  "",
  "Cancel any time — the role drops at the end of your billing period, no email required.",
  "",
  "👉 **[Checkout link goes here]**",
  "",
  "_21+ · research & entertainment only · not betting advice · 1-800-522-4700_",
].join("\n");

/** The full orientation, delivered once they're inside — one read, not six channels.
 *  Split across two pinned messages to stay under Discord's 2000-char cap. */
const HOW_THIS_WORKS = [
  "# 🗺️ How this room works",
  "",
  "Everything here in one read. Two minutes.",
  "",
  "## The two kinds of plays — this is the important part",
  "",
  "**The slate** (#📈-the-firehose, premium) is *every* play my system flags as positive EV that day. It's big. It carries no units and it is **not** part of the tracked record. It's the raw board — information, for you to judge.",
  "",
  "**The card** (#👑-todays-card, premium) is the handful of plays **I personally pick** out of that slate each day. These carry units. **This is the only thing the record tracks.** When you see the ARCHR record, it's this.",
  "",
  "Why the split: the system finds far more edges than anyone should fire at in a day. The card is me choosing which ones I'd actually put money behind. You get both — the full board *and* my selections.",
].join("\n");

const HOW_THIS_WORKS_CHANNELS = [
  "## The channels",
  "",
  "**📌 IMPORTANT**",
  "• **#welcome-and-rules** — the pitch and the rules. Rule 4 (never leak premium plays) is the one that gets you banned.",
  "• **#🔓-go-premium** — what premium unlocks and how to get it.",
  "• **#📣-announcements** — news, giveaways, anything big. From me, straight to you.",
  "",
  "**🎯 FREE — everyone**",
  "• **#🎁-free-play** — one handpicked play a day, from me, free. Tracked on its own record.",
  "• **#📊-the-ledger** — the ledger. Units and W/L for the premium card *and*, separately, for the free plays. Wins and losses both. Posted once the day's last play settles.",
  "• **#📚-sharp-school** — a bet-smarter tip most days. Units, CLV, staking, line shopping.",
  "",
  "**👑 PREMIUM**",
  "• **#👑-todays-card** · **#📈-the-firehose** · **#🤖-value-check** — see #🔓-go-premium.",
  "",
  "**👥 COMMUNITY — everyone**",
  "• **#🏆-hall-of-cashes** — winning slips only. Nothing else, no chatter. **Only after the play settles.**",
  "• **#💸-the-haul** — what you bought with what you won. Brag away.",
  "",
  "## Timing",
  "The card and the slate land about **3 hours before the first event of the day** — whatever sport that happens to be. Results post as soon as the day's last play is graded. No fixed clock, because the sports don't run on one.",
  "",
  "## Every sport, only when it's on",
  "This is not a baseball room or a UFC room. The system covers every sport it can price, and a sport shows up on the card the day it's actually running — not before. Quiet days are quiet on purpose.",
].join("\n");

const WINS_RULE = [
  "# 🏆 Hall of Cashes",
  "",
  "**Winning slips only. Images only — no captions.** Anything with text gets blocked automatically, so just drop the screenshot.",
  "",
  "⚠️ **Post only AFTER the play has settled.** A live slip is a leaked pick, and leaking premium plays is an instant permanent ban (rule 4). Once it's graded, flex all you want. 📸",
].join("\n");

const PURCHASES_RULE = [
  "# 💸 The Haul",
  "",
  "What the winnings bought. **Images only — no captions**, same as the Hall.",
  "",
  "Post the thing, not the picks. No lines, no screenshots of the card.",
].join("\n");

/**
 * The room, as data. Structure follows the owner's 2026-07-20 spec: a public wall
 * (pitch → rules → paywall), a free tier that shows the record it's missing out
 * on, a premium tier of three earning channels, and two tightly-ruled community
 * rooms. No verification gate — every non-premium channel is open on join, which
 * avoids needing a third-party reaction-role bot.
 *
 * Premium channels are genuinely HIDDEN, not "visible but locked": Discord shows
 * live messages to anyone who can view a channel, so a locked-but-visible
 * #📈-the-firehose would leak the very plays rule 4 bans. GO_PREMIUM does the FOMO job
 * instead, by naming each premium channel and its contents.
 */
export const SERVER_PLAN: ServerPlan = {
  roles: [
    { name: "Premium", color: BRIGHT_GREEN, hoist: true, note: "Whop-synced paid role — unlocks the 👑 PREMIUM ring. The only member role." },
    { name: "Mod", color: MOD_BLUE, hoist: true, note: "Moderators — keys to the staff channel + moderation." },
    { name: "Archer", color: GREEN, hoist: true, note: "The analyst voice (you)." },
  ],
  categories: [
    {
      name: "📌 IMPORTANT",
      visibility: "public",
      channels: [
        { name: "👋-start-here", topic: "What ARCHR is, and the rules. Read before anything else.", readOnly: true, pinned: [WELCOME_PITCH, WELCOME_RULES], aliases: ["welcome-and-rules"] },
        { name: "🔓-go-premium", topic: "What premium unlocks + how to join.", readOnly: true, pinned: [GO_PREMIUM], aliases: ["go-premium"] },
        { name: "📣-announcements", topic: "News, giveaways, and drops — from Archer.", readOnly: true, aliases: ["announcements"] },
      ],
    },
    {
      name: "🎯 FREE",
      visibility: "public",
      channels: [
        { name: "🗺️-how-this-works", topic: "The whole room explained in one read.", readOnly: true, pinned: [HOW_THIS_WORKS, HOW_THIS_WORKS_CHANNELS], aliases: ["how-this-works"] },
        { name: "🎁-free-play", topic: "One handpicked play a day, free. Tracked on its own record.", readOnly: true, aliases: ["free-play"] },
        { name: "📊-the-ledger", topic: "Units + W/L for the premium card and the free plays, tracked separately. Wins AND losses.", readOnly: true, aliases: ["results"] },
        { name: "📚-sharp-school", topic: "Bet smarter — units, CLV, staking, line shopping.", readOnly: true, aliases: ["tips"] },
      ],
    },
    {
      name: "👑 PREMIUM",
      visibility: "premium",
      channels: [
        { name: "👑-todays-card", topic: "Archer's handpicked plays, with units. The tracked record is built on this.", readOnly: true, aliases: ["todays-card"] },
        { name: "📈-the-firehose", topic: "Every +EV play the system finds today — all sports, model EV + market EV, best book. No units, info only.", readOnly: true, aliases: ["ev-slate"] },
        { name: "🤖-value-check", topic: "Ask the bot about any play, any sport — is the price worth it?", aliases: ["value-check"] },
      ],
    },
    {
      name: "👥 COMMUNITY",
      visibility: "public",
      channels: [
        { name: "🏆-hall-of-cashes", topic: "Winning slips only — images only, and only after the play settles.", pinned: [WINS_RULE], aliases: ["wins"], imageOnly: true },
        { name: "💸-the-haul", topic: "What the winnings bought. Images only.", pinned: [PURCHASES_RULE], aliases: ["purchases"], imageOnly: true },
      ],
    },
    {
      name: "🛠️ STAFF",
      visibility: "staff",
      channels: [
        { name: "🎛️-command-deck", topic: "Archer's cockpit — the daily handpick deck lands here. Invisible to members.", aliases: ["command-deck"] },
      ],
    },
  ],
};
