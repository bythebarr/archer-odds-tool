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

/**
 * The door. Rules and the compliance disclaimer are folded in here rather than
 * living in their own channels — one pin a new member actually reads beats three
 * channels they scroll past.
 */
const START_HERE = [
  "# 🎯 ARCHR — every-sport +EV, one board.",
  "",
  "This isn't a locks room. **Archer runs a model** across MLB and UFC — pricing every play against the market and surfacing where the number is actually in your favor. You get the plays, the edge, and the best book to get them at.",
  "",
  "**How the room works — three channels, that's it:**",
  "• **#todays-card** — the day's card. Every play, the number, the best book. One post, mid-morning.",
  "• **#results** — every posted play, graded daily, in units. Wins **and** losses.",
  "• **#chat** — talk through the card.",
  "",
  "## House rules",
  "**1. 21+.** By being here you confirm you're of legal betting age in your jurisdiction.",
  "**2. Research, not advice.** Every play is our opinion. You own your action. No outcome is guaranteed.",
  "**3. Units, never dollars.** Plays are staked in units (1u = your standard bet). We never tell you how much money to wager.",
  "**4. No touting or DM-selling.** Selling picks, shilling other services, or DMing members to sell = instant ban.",
  "**5. Be decent.** No harassment, bigotry, or scam links.",
  "**6. Wins and losses both get posted.** We never hide a bad day, and neither should you.",
  "",
  "## The fine print",
  "**ARCHR provides sports information and analysis for research and entertainment only. Nothing here is betting, financial, or investment advice.**",
  "• We do not accept, place, or handle bets or funds. We are not a sportsbook or betting operator.",
  "• Odds, model projections, hit-rates, and EV figures are estimates, may be inaccurate or stale, and carry no warranty. Past performance does not predict future results.",
  "• You alone are responsible for your betting decisions and for complying with the laws of your jurisdiction.",
  "• Gambling can be addictive. If you or someone you know has a problem, call or text the National Problem Gambling Helpline: **1-800-522-4700**. If it stops being fun, step away.",
].join("\n");

/**
 * The spine: one play surface, one record, one room. Deliberately small — every
 * channel here either auto-fills daily or is the single place members talk. A
 * channel nobody fills reads as a dead room, so the bar for adding one back is
 * "something posts to it every day, or the room is asking for it."
 */
export const SERVER_PLAN: ServerPlan = {
  roles: [
    { name: "Premium", color: BRIGHT_GREEN, hoist: true, note: "Whop-synced paid role — unlocks the 👑 card ring. The only member role." },
    { name: "Mod", color: MOD_BLUE, hoist: true, note: "Moderators — keys to the staff channel + moderation." },
    { name: "Archer", color: GREEN, hoist: true, note: "The analyst voice (you)." },
  ],
  categories: [
    {
      name: "🟢 START HERE",
      visibility: "public",
      channels: [
        { name: "start-here", topic: "What ARCHR is, how the room works, rules + disclaimer.", readOnly: true, pinned: [START_HERE] },
        { name: "announcements", topic: "Server news and launch drops.", readOnly: true },
      ],
    },
    {
      name: "👑 THE CARD",
      visibility: "premium",
      channels: [
        { name: "todays-card", topic: "The card — every play, the number, the best book. Posted daily by Archer.", readOnly: true },
        { name: "results", topic: "Every posted play, graded daily in units. Wins AND losses.", readOnly: true },
        { name: "chat", topic: "Talk through the card." },
      ],
    },
    {
      name: "🛠️ STAFF",
      visibility: "staff",
      channels: [
        { name: "command-deck", topic: "Archer's cockpit — curate and settle from here. Invisible to members." },
      ],
    },
  ],
};
