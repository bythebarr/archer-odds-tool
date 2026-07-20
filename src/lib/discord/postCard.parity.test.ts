import { describe, it, expect } from "vitest";
import { assembleSections, sectionsToEmbeds, slateLine, onlyTodaysEvents } from "./postCard";
import { toPlay } from "@/lib/engine/adapters/mlb";
import { ufcToPlay } from "@/lib/engine/adapters/ufc";
import { mosesAuthor } from "./brand";
import { SITE_URL } from "@/lib/siteUrl";
import { playLine, ufcPlayLine, prettyEventDate } from "@/lib/card/line";
import type { OddsPlay } from "@/lib/queries/oddsPool";
import type { Play } from "@/lib/engine";
import type { UfcBestPlay } from "./ufcBestPlays";

/**
 * Pins the poster's rendered output. Originally this held byte-for-byte parity
 * with the pre-registry poster; that parity was deliberately BROKEN on
 * 2026-07-20 when the room became all-sports:
 *
 *   • No always-present primary section. A sport with no plays renders NOTHING,
 *     so a quiet baseball day no longer posts an empty MLB card and UFC is
 *     simply absent the six days a week it isn't on. Event-timed surfacing now
 *     falls out of the data rather than a per-sport rule.
 *   • Section chrome derives from each adapter's own `meta` (icon/label/accent),
 *     so MLB is no longer ARCHR-green-and-special and a new sport needs no
 *     poster change.
 *
 * What's still locked: the line formatters, the author/footer/color placement,
 * and the card-vs-slate voice split.
 */

const LABEL = "Jul 15";
const RESEARCH_FOOTER =
  "Research/entertainment only · not betting advice · 21+ · gamble responsibly 1-800-522-4700";
// Accents now come from sportsMeta, not poster-local constants.
const MLB_BLUE = 0x3b82f6;
const UFC_RED = 0xef4444;

function oddsPlay(over: Partial<OddsPlay> = {}): OddsPlay {
  return {
    key: "g1:h2h:home",
    sport: "mlb",
    matchId: "g1",
    startUtc: new Date("2026-07-15T23:05:00Z"), // 7:05p ET
    href: "/mlb",
    home: { name: "Red Sox", meta: "BOS" },
    away: { name: "Yankees", meta: "NYY" },
    market: "h2h",
    kind: "ml",
    side: "home",
    selectionLabel: "Red Sox",
    backed: "home",
    bestPrice: 102,
    bestDecimal: 2.02,
    bestBookKey: "fanduel",
    bestBookName: "FanDuel",
    bestBookInitials: "FD",
    booksCount: 6,
    ev: 0.03,
    modelEv: 0.062,
    ...over,
  } as OddsPlay;
}

function ufcBestPlay(over: Partial<UfcBestPlay> = {}): UfcBestPlay {
  return {
    boutId: "bout1",
    side: "blue",
    pickFighterId: "fB",
    pickName: "Alessandro Costa",
    opponentName: "Ode' Osbourne",
    prob: 0.58,
    bestPrice: 150,
    bestBookName: "draftkings",
    archerEv: 0.072,
    titleBout: false,
    weightClass: "Flyweight",
    finishLean: null,
    ...over,
  };
}

const EVENT_DATE = new Date("2026-07-19T00:00:00Z");
const EVENT_TITLE = "UFC Fight Night: Costa vs Osbourne";

/** The MLB section as the poster builds it now — chrome from the adapter's meta. */
function oracleMlbEmbed(picks: OddsPlay[]) {
  return {
    author: mosesAuthor(),
    title: `⚾ MLB · ${LABEL}`,
    url: `${SITE_URL}/mlb`,
    description: picks.map(playLine).join("\n"),
    color: MLB_BLUE,
    footer: { text: RESEARCH_FOOTER },
  };
}

/** The UFC section — same shape, its own meta accent, event label from the play. */
function oracleUfcEmbed(bouts: UfcBestPlay[]) {
  return {
    author: mosesAuthor(),
    title: `🥊 UFC · ${EVENT_TITLE} · ${prettyEventDate(EVENT_DATE)}`,
    url: `${SITE_URL}/ufc`,
    description: bouts.map(ufcPlayLine).join("\n"),
    color: UFC_RED,
    footer: { text: RESEARCH_FOOTER },
  };
}

const mlbPicks = [oddsPlay(), oddsPlay({ key: "g2:totals:over", side: "over", selectionLabel: "Over 8.5", kind: "total", market: "totals", modelEv: 0.09 })];
const ufcBouts = [ufcBestPlay(), ufcBestPlay({ boutId: "bout2", side: "red", pickName: "Petr Yan", opponentName: "Song Yadong", titleBout: true, archerEv: 0.05 })];

const mlbPlays = mlbPicks.map((p) => toPlay(p, "2026-07-15"));
const ufcPlays = ufcBouts.map((p) => ufcToPlay(p, EVENT_DATE, EVENT_TITLE));

function embeds(plays: Parameters<typeof assembleSections>[0]) {
  return sectionsToEmbeds(assembleSections(plays, LABEL));
}

describe("board rendering — sections come from the registry, no primary sport", () => {
  it("renders a section per sport that HAS plays, in registry order", () => {
    expect(embeds([...mlbPlays, ...ufcPlays])).toEqual([oracleMlbEmbed(mlbPicks), oracleUfcEmbed(ufcBouts)]);
  });

  it("MLB only (nothing else running)", () => {
    expect(embeds(mlbPlays)).toEqual([oracleMlbEmbed(mlbPicks)]);
  });

  it("a UFC-only day posts ONLY the UFC section — no empty MLB card", () => {
    // The regression this guards: an all-sports room must not announce a sport
    // that isn't playing. Previously MLB rendered an empty section every day.
    expect(embeds(ufcPlays)).toEqual([oracleUfcEmbed(ufcBouts)]);
  });

  it("empty board → no embeds at all (the caller posts 'no card is a card')", () => {
    expect(embeds([])).toEqual([]);
  });
});

describe("slate voice — flat, both EV lenses, never units", () => {
  it("shows model AND market EV and omits units entirely", () => {
    const line = slateLine(mlbPlays[0]);
    expect(line).toContain("model +6.2%");
    expect(line).toContain("market +3.0%");
    expect(line).not.toMatch(/\d+u\b/); // nothing on the slate is staked
  });

  it("uses the flat read, not the sport's card voice", () => {
    expect(slateLine(mlbPlays[0])).not.toBe(mlbPlays[0].display?.line);
  });

  it("renders a sport with no model EV without a dangling separator", () => {
    const noModel = { ...mlbPlays[0], modelEv: null };
    const line = slateLine(noModel);
    expect(line).toContain("market +3.0%");
    expect(line).not.toContain("model");
    expect(line).not.toContain("· ·");
  });
});

describe("event-timed surfacing — a sport appears only on its own day", () => {
  const CARD_DATE = "2026-07-20";

  function at(startUtc: string, sportKey = "mlb"): Play {
    return { ...mlbPlays[0], sportKey, playKey: `k-${startUtc}-${sportKey}`, startUtc: new Date(startUtc) };
  }

  it("keeps an event happening today", () => {
    // 7:05p ET on the 20th.
    expect(onlyTodaysEvents([at("2026-07-20T23:05:00Z")], CARD_DATE)).toHaveLength(1);
  });

  it("drops a UFC card that isn't until later in the week", () => {
    // The actual bug: UFC's adapter looks 3 days ahead, so Saturday's card was
    // being posted (and talked about) every day from Wednesday.
    expect(onlyTodaysEvents([at("2026-07-23T02:00:00Z", "ufc")], CARD_DATE)).toEqual([]);
  });

  it("KEEPS a late-night ET event even though it's tomorrow in UTC", () => {
    // 10pm ET Monday = 02:00Z Tuesday. Comparing in UTC would hold this back a
    // day — posting the card AFTER the fight started.
    expect(onlyTodaysEvents([at("2026-07-21T02:00:00Z", "ufc")], CARD_DATE)).toHaveLength(1);
  });

  it("drops yesterday's leftovers", () => {
    expect(onlyTodaysEvents([at("2026-07-19T23:05:00Z")], CARD_DATE)).toEqual([]);
  });

  it("filters per-play, not per-sport — today's game survives a future one", () => {
    const kept = onlyTodaysEvents(
      [at("2026-07-20T23:05:00Z"), at("2026-07-25T23:05:00Z")],
      CARD_DATE
    );
    expect(kept).toHaveLength(1);
  });
});
