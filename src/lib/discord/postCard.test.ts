import { describe, it, expect } from "vitest";
import { unitsFor, selectionDisplay, playLine } from "./postCard";
import type { OddsPlay } from "@/lib/queries/oddsPool";

describe("unitsFor (Kelly sizing)", () => {
  it("sizes up with the edge", () => {
    // +100 (b=1): quarter Kelly / 2%-unit → 12.5 × edge.
    expect(unitsFor(0.1, 100)).toBe(1.25);
    expect(unitsFor(0.2, 100)).toBe(2.5);
  });

  it("stakes MORE on a favorite than a dog for the SAME edge (odds-aware)", () => {
    // 10% edge at -200 (b=0.5) sizes bigger than 10% at +100 (b=1): the win is likelier.
    expect(unitsFor(0.1, -200)).toBe(2.5);
    expect(unitsFor(0.1, -200)).toBeGreaterThan(unitsFor(0.1, 100));
  });

  it("caps at 3u on a monster edge (short price) and floors at 0.25u on a sliver", () => {
    expect(unitsFor(0.4, 100)).toBe(3); // would be 5u uncapped
    expect(unitsFor(0.005, 100)).toBe(0.25); // tiny edge → token play
  });

  it("clamps long-priced dogs hard, no matter how big the edge", () => {
    // A huge +60% edge is capped purely by price: <=+150 heavy, +200+ small.
    expect(unitsFor(0.6, 140)).toBe(3); // short dog → still heavy
    expect(unitsFor(0.6, 175)).toBe(1.5); // mid dog
    expect(unitsFor(0.6, 250)).toBe(0.75); // longshot → small despite the edge
    expect(unitsFor(0.6, 400)).toBe(0.5); // deep longshot → smallest
  });

  it("always lands on a clean 0.25u increment", () => {
    for (const [ev, price] of [[0.03, 120], [0.07, -130], [0.15, 150], [0.25, -110]] as const) {
      const u = unitsFor(ev, price);
      expect(u * 4).toBe(Math.round(u * 4));
    }
  });
});

// Minimal fixture — only the fields the display helpers read.
function play(over: Partial<OddsPlay>): OddsPlay {
  return {
    sport: "mlb",
    side: "home",
    selectionLabel: "Yankees",
    home: { name: "Red Sox", meta: "BOS" },
    away: { name: "Yankees", meta: "NYY" },
    bestPrice: 102,
    bestBookName: "FanDuel",
    modelEv: 0.062,
    kind: "ml",
    startUtc: new Date("2026-07-11T23:05:00Z"), // 7:05 PM ET (July, UTC-4)
    ...over,
  } as OddsPlay;
}

describe("selectionDisplay", () => {
  it("leaves team-named sides (ML/spread) alone — they're self-identifying", () => {
    expect(selectionDisplay(play({ side: "home", selectionLabel: "Yankees" }))).toBe("Yankees");
    expect(selectionDisplay(play({ side: "away", selectionLabel: "Yankees -1.5" }))).toBe(
      "Yankees -1.5"
    );
  });

  it("prefixes the matchup on totals/draws, which otherwise name no game", () => {
    expect(selectionDisplay(play({ side: "over", selectionLabel: "Over 8.5" }))).toBe(
      "NYY @ BOS Over 8.5"
    );
    expect(selectionDisplay(play({ side: "under", selectionLabel: "Under 8.5" }))).toBe(
      "NYY @ BOS Under 8.5"
    );
  });

  it("falls back to full team names when abbreviations are missing", () => {
    const p = play({ side: "over", selectionLabel: "Over 8.5", home: { name: "Red Sox" }, away: { name: "Yankees" } });
    expect(selectionDisplay(p)).toBe("Yankees @ Red Sox Over 8.5");
  });
});

describe("playLine", () => {
  it("renders a total with its matchup, price, book and EV — but NOT units", () => {
    // Units moved out of the sport renderers: the stake is the owner's per-play
    // decision, appended by the poster, so a line can never print a number the
    // ledger disagrees with.
    const line = playLine(play({ kind: "total", side: "over", selectionLabel: "Over 8.5", bestPrice: 102 }));
    expect(line).toContain("NYY @ BOS Over 8.5");
    expect(line).toContain("+102");
    expect(line).not.toMatch(/\d+(\.\d+)?u/);
  });
});
