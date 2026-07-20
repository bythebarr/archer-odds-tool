import "dotenv/config";
import {
  assembleSections,
  sectionsToEmbeds,
  cardIntro,
  slateLine,
  onlyTodaysEvents,
  postWebhook,
} from "@/lib/discord/postCard";
import { buildStreamRecap, buildRecapEmbeds } from "@/lib/discord/postResults";
import { renderTip, tipForDate } from "@/lib/discord/postTips";
import { mosesAuthor } from "@/lib/discord/brand";
import type { Play } from "@/lib/engine";
import type { PostedPlay } from "@/generated/prisma/client";

/**
 * Fire one of each daily post into the real channels, using fabricated plays.
 *
 * The point is to see the room as a member will BEFORE any of it is live: right
 * channel, right voice, right numbers, nothing leaking where it shouldn't. Every
 * post is built by the SAME renderers the crons use — no mock copy — so what
 * lands here is what will land for real.
 *
 *   npm run discord:testpost
 *
 * Clean up afterwards with: npm run discord:purge -- --apply
 */

const ARCHR_GREEN = 0x06996b;
const RESEARCH_FOOTER =
  "Research/entertainment only · not betting advice · 21+ · gamble responsibly 1-800-522-4700";
const LABEL = "Sample";
/** The ET day these samples are "for" — everything is filtered against it. */
const SAMPLE_DATE = "2026-07-20";

function play(over: Partial<Play> = {}): Play {
  return {
    sportKey: "mlb",
    playKey: "sample-1",
    eventRef: "g1",
    postedForDate: "2026-07-20",
    startUtc: new Date("2026-07-20T23:05:00Z"),
    selection: { market: null, kind: "ml", side: "home", point: null, label: "Yankees ML" },
    bestPrice: -120,
    bestBookName: "FanDuel",
    marketEv: 0.031,
    modelEv: 0.062,
    suggestedUnits: 1.5,
    display: { line: "`MLB ML` **Yankees ML** -120 · FanDuel · +6.2% Edge · 1.5u · 7:05p ET" },
    ...over,
  };
}

/** A believable mixed-sport day, so the all-sports rendering is actually exercised. */
const CARD: Play[] = [
  play(),
  play({
    playKey: "sample-2",
    selection: { market: null, kind: "total", side: "over", point: 8.5, label: "NYY @ BOS Over 8.5" },
    bestPrice: 102,
    bestBookName: "DraftKings",
    modelEv: 0.09,
    marketEv: 0.024,
    suggestedUnits: 2,
    display: { line: "`MLB TOT` **NYY @ BOS Over 8.5** +102 · DraftKings · +9.0% Edge · 2u · 7:05p ET" },
  }),
  play({
    sportKey: "tennis",
    playKey: "sample-3",
    startUtc: new Date("2026-07-20T17:00:00Z"),
    selection: { market: null, kind: "ml", side: "home", point: null, label: "Carlos Alcaraz" },
    bestPrice: -145,
    bestBookName: "BetMGM",
    modelEv: 0.041,
    marketEv: 0.018,
    suggestedUnits: 1,
    display: { line: "`TEN ML` **Carlos Alcaraz** -145 · BetMGM · +4.1% Edge · 1u · 1:00p ET" },
  }),
];

const SLATE: Play[] = [
  play({
    playKey: "sample-4",
    selection: { market: null, kind: "prop", side: "over", point: 6.5, label: "Tarik Skubal Over 6.5 Ks" },
    bestPrice: -115,
    bestBookName: "Caesars",
    modelEv: 0.048,
    marketEv: 0.012,
  }),
  // 10pm ET the same evening — after midnight UTC, but still TODAY in ET, so it
  // belongs on the card. This is the case a UTC comparison would wrongly drop.
  play({
    sportKey: "ufc",
    playKey: "sample-5",
    startUtc: new Date("2026-07-21T02:00:00Z"),
    selection: { market: null, kind: "ml", side: "red", point: null, label: "Alessandro Costa" },
    bestPrice: 150,
    bestBookName: "DraftKings",
    modelEv: 0.072,
    marketEv: null,
    display: { sectionLabel: "UFC Fight Night · tonight" },
  }),
  // A card three days out. The room must NOT mention this today — it should be
  // filtered out below, and its absence from the post is the thing to verify.
  play({
    sportKey: "ufc",
    playKey: "sample-future",
    startUtc: new Date("2026-07-23T02:00:00Z"),
    selection: { market: null, kind: "ml", side: "blue", point: null, label: "SHOULD NOT APPEAR — fight is Thursday" },
    bestPrice: 120,
    bestBookName: "FanDuel",
    modelEv: 0.05,
    marketEv: null,
  }),
  play({
    sportKey: "soccer",
    playKey: "sample-6",
    startUtc: new Date("2026-07-20T19:30:00Z"),
    selection: { market: null, kind: "ml", side: "draw", point: null, label: "Arsenal v Chelsea Draw" },
    bestPrice: 240,
    bestBookName: "FanDuel",
    modelEv: null,
    marketEv: 0.035,
  }),
];

function posted(over: Partial<PostedPlay> = {}): PostedPlay {
  return {
    id: "x",
    postedForDate: "2026-07-19",
    playKey: "k",
    sport: "mlb",
    matchId: "g",
    market: null,
    kind: "ml",
    side: "home",
    point: null,
    selectionLabel: "Yankees ML",
    bestPrice: -120,
    bestBookName: "FanDuel",
    ev: 0.06,
    units: 1.5,
    stream: "card",
    mlbPlayerId: null,
    statCategory: null,
    result: "hit",
    voided: false,
    gradedAt: new Date(),
    createdAt: new Date(),
    ...over,
  } as PostedPlay;
}

async function send(env: string, label: string, body: unknown) {
  const url = process.env[env];
  if (!url) {
    console.log(`  ✗ ${label} — ${env} not set, skipped`);
    return;
  }
  await postWebhook(url, body);
  console.log(`  ✓ ${label}`);
}

async function main() {
  console.log("\nARCHR test post — sample data, real channels\n");

  // Apply the same event-timed rule the real board does, so the samples can't
  // show something production would hold back.
  const card = onlyTodaysEvents(CARD, SAMPLE_DATE);
  const slate = onlyTodaysEvents(SLATE, SAMPLE_DATE);
  const dropped = CARD.length + SLATE.length - card.length - slate.length;
  console.log(`  (event-timed filter held back ${dropped} play(s) not happening today)\n`);

  // 👑 the card, with its welcome line
  await send("DISCORD_WEBHOOK_URL", "#👑-todays-card", {
    username: "Moses, Leader of Many",
    content: cardIntro(card, slate, LABEL),
    embeds: sectionsToEmbeds(assembleSections(card, LABEL, "card")),
  });

  // 🎁 the free play
  await send("DISCORD_FREE_WEBHOOK_URL", "#🎁-free-play", {
    username: "Moses, Leader of Many",
    embeds: [
      {
        author: mosesAuthor(),
        title: `🎯 Free Play · ${LABEL}`,
        description: `${card[0].display?.line}\n\nTracked in #📊-the-ledger on its own record — wins and losses.`,
        color: ARCHR_GREEN,
        footer: { text: RESEARCH_FOOTER },
      },
    ],
  });

  // 📈 the slate — no units anywhere in here
  const slateEmbeds = sectionsToEmbeds(assembleSections(slate, LABEL, "slate"));
  slateEmbeds[0] = { ...slateEmbeds[0], title: `📊 Full +EV Slate · ${LABEL}` };
  slateEmbeds[slateEmbeds.length - 1] = {
    ...slateEmbeds[slateEmbeds.length - 1],
    footer: { text: `No units — information only. Today's staked card is in #👑-todays-card. ${RESEARCH_FOOTER}` },
  };
  await send("DISCORD_SLATE_WEBHOOK_URL", "#📈-the-firehose", {
    username: "Moses, Leader of Many",
    embeds: slateEmbeds,
  });

  // 📊 results — both ledgers, one winning day and a losing free play
  const cardRows = [
    posted(),
    posted({ selectionLabel: "NYY @ BOS Over 8.5", kind: "total", side: "over", units: 2, bestPrice: 102, result: "miss" }),
    posted({ selectionLabel: "Carlos Alcaraz", sport: "tennis", units: 1, bestPrice: -145, result: "hit" }),
  ];
  const freeRows = [posted({ stream: "free", selectionLabel: "Dodgers ML", units: 1, bestPrice: -130, result: "miss" })];
  await send("DISCORD_RESULTS_WEBHOOK_URL", "#📊-the-ledger", {
    username: "Moses, Leader of Many",
    embeds: buildRecapEmbeds(
      buildStreamRecap(cardRows, cardRows, LABEL),
      buildStreamRecap(freeRows, freeRows, LABEL),
      LABEL
    ),
  });

  // 📚 the tip
  const tip = tipForDate("2026-07-20");
  if (tip) {
    await send("DISCORD_TIPS_WEBHOOK_URL", "#📚-sharp-school", {
      username: "Moses, Leader of Many",
      embeds: [renderTip(tip)],
    });
  }

  console.log("\n✓ Sent. Go look at the room.");
  console.log("  Slate line sample: " + slateLine(slate[0]));
  console.log("\n  Clean up with: npm run discord:purge -- --apply\n");
}

main().catch((err) => {
  console.error("\n✗", err instanceof Error ? err.message : err, "\n");
  process.exit(1);
});
