import { describe, it, expect } from "vitest";
import { unitsFor, selectionDisplay, playLine } from "./postCard";
import type { OddsPlay } from "@/lib/queries/oddsPool";

describe("unitsFor", () => {
  it("stakes by edge tier, capped at 2u", () => {
    expect(unitsFor(0.005)).toBe(1); // a thin-but-positive play (no edge floor now)
    expect(unitsFor(0.049)).toBe(1); // just under the 1.5u tier
    expect(unitsFor(0.05)).toBe(1.5); // 1.5u tier boundary
    expect(unitsFor(0.079)).toBe(1.5);
    expect(unitsFor(0.08)).toBe(2); // 2u tier boundary
    expect(unitsFor(0.45)).toBe(2); // cap holds on a big edge (no ceiling now)
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
  it("renders a total with its matchup, price, book, EV and units", () => {
    const line = playLine(play({ side: "over", selectionLabel: "Over 8.5", kind: "total" }));
    expect(line).toContain("**NYY @ BOS Over 8.5**");
    expect(line).toContain("+102");
    expect(line).toContain("Edge");
    expect(line).toContain("1.5u"); // 0.062 EV → 1.5u
    expect(line).toContain("7:05p ET"); // per-line start time
  });
});
