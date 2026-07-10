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
  | "public" // @everyone can see (the free funnel)
  | "verified" // @Verified and up (community, post-rules-gate)
  | "premium" // @Premium role only (the paid core)
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
  if (v === "verified") return ["Verified", "Premium", "Mod", "Archer"];
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

// ARCHR greens + accents (ints). Founders gets a warm gold to stand apart.
const GREEN = 0x06996b;
const BRIGHT_GREEN = 0x2fd996;
const GOLD = 0xe0b04a;
const SLATE = 0x8ba398;
const MOD_BLUE = 0x4a6cf0;

const RULES = [
  "**ARCHR — house rules**",
  "",
  "**1. 21+.** By being here you confirm you're of legal betting age in your jurisdiction.",
  "**2. Research, not advice.** Every play is our opinion. You own your action. No outcome is guaranteed.",
  "**3. Units, never dollars.** Plays are staked in units (1u = your standard bet). We never tell you how much money to wager.",
  "**4. No touting or DM-selling.** Selling picks, shilling other services, or DMing members to sell = instant ban.",
  "**5. Be decent.** No harassment, bigotry, or scam links.",
  "**6. Wins and losses both get posted.** We never hide a bad day, and neither should you.",
  "**7. Gamble responsibly.** If it stops being fun, step away. 1-800-522-4700.",
  "",
  "React ✅ below to confirm you're 21+ and agree — that unlocks the rest of the server.",
].join("\n");

const DISCLAIMER = [
  "**ARCHR provides sports information and analysis for research and entertainment only. Nothing here is betting, financial, or investment advice.**",
  "",
  "• We do not accept, place, or handle bets or funds. We are not a sportsbook or betting operator.",
  "• Odds, model projections, hit-rates, and EV figures are estimates, may be inaccurate or stale, and carry no warranty. Past performance does not predict future results.",
  "• You alone are responsible for your betting decisions and for complying with the laws of your jurisdiction. Must be 21+ (or legal age where you are).",
  "• Gambling can be addictive. If you or someone you know has a problem, call or text the National Problem Gambling Helpline: **1-800-522-4700**.",
].join("\n");

const START_HERE = [
  "# 🎯 ARCHR — every-sport +EV, one board.",
  "",
  "This isn't a locks room. **Archer runs a model** across MLB and UFC — pricing every play against the market and surfacing where the number is actually in your favor. You get the plays, the edge, and the best book to get them at. We track every pick in units, in the open — **wins and losses**.",
  "",
  "**Free here:** one lean a day (#todays-lean) + our full public record (#results).",
  "**Premium unlocks:** the complete daily card, the model's edge on every play, fight-night fighter-math leans, on-demand bet grading with `/betcheck`, and the community.",
  "",
  "👉 Start a **3-day free trial** in #get-access.",
  "",
  "_Research & entertainment only. Not betting advice. 21+. Gambling problem? Call/text 1-800-522-4700._",
].join("\n");

export const SERVER_PLAN: ServerPlan = {
  roles: [
    { name: "Premium", color: BRIGHT_GREEN, hoist: true, note: "Whop-synced paid role — unlocks the 🔒 premium ring." },
    { name: "Founders", color: GOLD, hoist: true, note: "First 20 members, $15/mo locked for life. Seeds the room." },
    { name: "Tail Captain", color: GREEN, hoist: true, note: "Earned — monthly leaderboard / most-tailed member." },
    { name: "Verified", color: SLATE, hoist: false, note: "Passed the ✅ rules gate. Confirms 21+, unlocks chat." },
    { name: "Mod", color: MOD_BLUE, hoist: true, note: "Moderators — keys to staff channels + moderation." },
    { name: "Archer", color: GREEN, hoist: true, note: "The analyst voice (you)." },
  ],
  categories: [
    {
      name: "🟢 START HERE",
      visibility: "public",
      channels: [
        { name: "announcements", topic: "Server news, big wins, launch drops.", readOnly: true },
        { name: "start-here", topic: "What ARCHR is + how it works + how to join.", readOnly: true, pinned: [START_HERE] },
        { name: "rules", topic: "Read + react ✅ to verify (21+).", readOnly: true, pinned: [RULES] },
        { name: "disclaimer", topic: "Compliance — research/entertainment only, 21+.", readOnly: true, pinned: [DISCLAIMER] },
        { name: "todays-lean", topic: "One free lean a day, auto-posted by Archer.", readOnly: true },
        { name: "results", topic: "Public unit record — updated daily. Wins AND losses.", readOnly: true },
        { name: "general", topic: "Open chat for everyone." },
        { name: "get-access", topic: "Start your 3-day trial and unlock premium." },
      ],
    },
    {
      name: "🔒 PREMIUM",
      visibility: "premium",
      channels: [
        { name: "full-card", topic: "Archer's Best Plays — the full daily +EV card.", readOnly: true },
        { name: "fight-night", topic: "Fighter-math's best leans on the next UFC card.", readOnly: true },
        { name: "bet-check", topic: "Grade your own bet with /betcheck — good/fair/poor value." },
        { name: "by-sport", topic: "MLB · UFC · F1 · tennis · soccer threads." },
        { name: "tail-chat", topic: "React to the card, share action, tail together." },
        { name: "member-plays", topic: "Post your own plays for the room to tail." },
        { name: "bankroll-101", topic: "Units, CLV, staking discipline — bet smarter." },
        { name: "leaderboard", topic: "Monthly unit leaders. Climb it.", readOnly: true },
      ],
    },
    {
      name: "👥 COMMUNITY",
      visibility: "verified",
      channels: [
        { name: "wins", topic: "Post your cashed slips. 🎉" },
        { name: "introductions", topic: "Say hey — who you are, what you bet." },
        { name: "sports-talk", topic: "Games, takes, off-topic sports chatter." },
        { name: "support", topic: "Questions, help, feedback." },
        { name: "responsible-gaming", topic: "Resources + help. 1-800-522-4700.", readOnly: true, pinned: [
          "**Bet for fun, within your means.** If gambling stops being fun or starts costing more than you can afford, step away.\n\nNational Problem Gambling Helpline — call or text **1-800-522-4700**, 24/7, free and confidential. Most sportsbooks also offer deposit limits, cool-off periods, and self-exclusion — use them.",
        ] },
      ],
    },
    {
      name: "🛠️ STAFF",
      visibility: "staff",
      channels: [
        { name: "mod-log", topic: "Moderation audit trail.", readOnly: true },
        { name: "staff-chat", topic: "Private staff coordination." },
      ],
    },
  ],
};
