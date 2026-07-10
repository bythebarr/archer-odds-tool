/**
 * Curated welcome/how-to content, posted + pinned into channels that the
 * provisioner leaves empty, so the room reads as built and lived-in rather than
 * a bare skeleton. Keyed by channel name; each entry is one or more messages
 * (each ≤ 2000 chars, Discord's limit). Seeded idempotently by seed-content.ts
 * — a channel that already has pins is skipped, so re-running is safe.
 */

export const CHANNEL_CONTENT: Record<string, string[]> = {
  announcements: [
    [
      "# 🏹 Welcome to ARCHR.",
      "",
      "The room is live. How it works:",
      "• **#todays-lean** — one free play a day, on the house.",
      "• **#results** — every pick we post, graded daily. Wins *and* losses, always.",
      "• **Premium** unlocks the full card, fight-night leans, `/betcheck`, and the community.",
      "",
      "New here? Start in **#start-here** → verify in **#rules** → grab access in **#get-access**.",
      "",
      "Let's build something real. 🎯",
    ].join("\n"),
  ],

  "get-access": [
    [
      "# 🎫 Get access",
      "",
      "**Free** gets you a daily lean + our full public record.",
      "**Premium** unlocks everything:",
      "✅ The full daily +EV card — every play, the number, the best book",
      "✅ Fight-night fighter-math leans",
      "✅ `/betcheck` — grade any bet's value on demand",
      "✅ The community, the leaderboard, and bankroll school",
      "",
      "**Tiers**",
      "• Monthly — **$25/mo**",
      "• Quarterly — **$60** (save 20%)",
      "• Founders — first 20 members lock **$15/mo for life**",
      "",
      "👉 **3-day free trial** — link drops here at launch.",
      "",
      "_21+ · research & entertainment only · not betting advice · 1-800-522-4700_",
    ].join("\n"),
  ],

  "bankroll-101": [
    [
      "# 💰 Bankroll 101 — bet like it's a job, not a lottery ticket.",
      "",
      "**Units, not dollars.** 1 unit = your standard bet (most people use ~1% of their roll). We stake every play in units so it fits any bankroll — and so nobody's ever told to risk a dollar amount.",
      "",
      "**Sizing.** Most plays are 1u. Bigger edges earn 1.5–2u, capped. No edge? No bet.",
      "",
      "**CLV is the real scoreboard.** Closing Line Value = did you beat the number the market closed at? Consistently beating the close means you're winning long-term, even through cold streaks.",
      "",
      "**Discipline > action.** A 'no card today' is a winning decision. The goal is +EV over *hundreds* of bets — not a hero parlay tonight.",
      "",
      "_Bet for fun, within your means. If it stops being fun, step away. 1-800-522-4700._",
    ].join("\n"),
  ],

  "by-sport": [
    [
      "# 🏟️ By sport",
      "",
      "Deeper convo for each sport we cover — **MLB · UFC · F1 · tennis · soccer**. Matchup talk, questions on specific games, shop-talk with the room.",
      "",
      "The daily card lands in **#full-card**; this is where the *why* behind the plays lives.",
    ].join("\n"),
  ],

  "member-plays": [
    [
      "# 🗳️ Member plays",
      "",
      "Posting your own? Keep it clean so the room can tail:",
      "",
      "**`SPORT · Pick · Line/Price · Book · Units · (one-line why)`**",
      "e.g. `MLB · Yankees ML · -120 · FD · 1u · model edge + bullpen rest`",
      "",
      "Wins and losses both stay up — we build trust the same way Archer does. 🤝",
    ].join("\n"),
  ],

  leaderboard: [
    [
      "# 🏆 Leaderboard",
      "",
      "Track your plays, climb the board. Monthly unit leaders earn the **@Tail Captain** role and the bragging rights that come with it. Resets on the 1st.",
      "",
      "Post in **#member-plays** to get counted. _(Automated tracking coming online.)_",
    ].join("\n"),
  ],

  "tail-chat": [
    [
      "# 🎙️ Tail chat",
      "",
      "The heart of the room. React to the card, share your action, post your slips, talk through the plays in real time. This is where a feed becomes a community.",
      "",
      "Be decent, stay disciplined, have fun. 🏹",
    ].join("\n"),
  ],

  wins: [
    [
      "# 🎉 Wins",
      "",
      "Cashed a play? Post the slip. 📸",
      "Real members winning is what this is about — and it's the best proof there is. Losses happen too; we keep it honest in **#results** either way.",
    ].join("\n"),
  ],

  introductions: [
    [
      "# 👋 Introductions",
      "",
      "Drop a hello — where you're from, what sports you follow, how long you've been betting. No pressure, just good to know who's in the room.",
    ].join("\n"),
  ],

  support: [
    [
      "# 🆘 Support",
      "",
      "Questions, issues, or feedback? Post here and we'll get to you. Found a bug or have an idea for the room? We want to hear it — this place gets better with your input.",
    ].join("\n"),
  ],

  "sports-talk": [
    [
      "# 🎲 Sports talk",
      "",
      "Games, takes, trash talk, off-topic sports chatter. Keep it fun and keep it decent.",
    ].join("\n"),
  ],
};
