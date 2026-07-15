import { describe, it, expect } from "vitest";
import { assembleSections, sectionsToEmbeds, freeLeanText } from "./postCard";
import { toPlay } from "@/lib/engine/adapters/mlb";
import { ufcToPlay } from "@/lib/engine/adapters/ufc";
import { mosesAuthor } from "./brand";
import { SITE_URL } from "@/lib/siteUrl";
import { playLine, ufcPlayLine, mlbFreeLean, ufcFreeLean, prettyEventDate } from "@/lib/card/line";
import type { OddsPlay } from "@/lib/queries/oddsPool";
import type { UfcBestPlay } from "./ufcBestPlays";

/**
 * BYTE-FOR-BYTE parity: the board is now assembled from the sport registry
 * (SPORTS.flatMap(listPlays)) instead of a hardcoded MLB pool + appended UFC
 * embed. This test pins the produced Discord embeds to EXACTLY the shape the old
 * poster emitted — the MLB-green Best Plays card + the UFC-red Fight-Night embed
 * — using the same @/lib/card/line formatters as the oracle. If the registry
 * rewrite ever drifts the output, this fails. The poster is the owner's LOCKED
 * 9:30/10:30 machine, so this is the safety net for "must not silently regress."
 */

const LABEL = "Jul 15";
const RESEARCH_FOOTER =
  "Research/entertainment only · not betting advice · 21+ · gamble responsibly 1-800-522-4700";
const EMPTY_CARD =
  "_No plays cleared ARCHR Edge today. No card is a card — we don't force action._";
const ARCHR_GREEN = 0x06996b;
const UFC_RED = 0xd20a0a;

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

/** The MLB Best Plays card exactly as the old poster built it (single chunk). */
function oracleMlbEmbed(picks: OddsPlay[]) {
  return {
    author: mosesAuthor(),
    title: `🎯 ARCHR Edge · Best Plays · ${LABEL}`,
    url: `${SITE_URL}/slate`,
    description: picks.length ? picks.map(playLine).join("\n") : EMPTY_CARD,
    color: ARCHR_GREEN,
    footer: { text: RESEARCH_FOOTER },
  };
}

/** The Fight-Night embed exactly as the old buildUfcEmbed produced it. */
function oracleUfcEmbed(bouts: UfcBestPlay[]) {
  return {
    author: mosesAuthor(),
    title: `🥊 Fight Night — ${EVENT_TITLE} · ${prettyEventDate(EVENT_DATE)}`,
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

describe("board parity — registry-sourced embeds equal the old poster's", () => {
  it("MLB card + UFC Fight-Night (both present)", () => {
    expect(embeds([...mlbPlays, ...ufcPlays])).toEqual([oracleMlbEmbed(mlbPicks), oracleUfcEmbed(ufcBouts)]);
  });

  it("MLB only (no UFC card imminent)", () => {
    expect(embeds(mlbPlays)).toEqual([oracleMlbEmbed(mlbPicks)]);
  });

  it("no MLB plays still shows the 'no card is a card' MLB embed, then UFC", () => {
    // The primary (MLB) section always renders — empty means the message, not a
    // missing section — exactly as the old poster's packDescriptions([]) did.
    expect(embeds(ufcPlays)).toEqual([oracleMlbEmbed([]), oracleUfcEmbed(ufcBouts)]);
  });

  it("empty board → just the empty MLB card", () => {
    expect(embeds([])).toEqual([oracleMlbEmbed([])]);
  });
});

describe("free-lean parity — MLB first, then the next sport", () => {
  it("prefers the top MLB play's tease", () => {
    expect(freeLeanText([...mlbPlays, ...ufcPlays])).toBe(mlbFreeLean(mlbPicks[0]));
  });

  it("falls back to the top UFC lean on an MLB-dry day", () => {
    expect(freeLeanText(ufcPlays)).toBe(ufcFreeLean(ufcBouts[0]));
  });

  it("no plays → no tease", () => {
    expect(freeLeanText([])).toBeNull();
  });
});
