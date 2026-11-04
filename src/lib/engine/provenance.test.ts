import { describe, it, expect } from "vitest";
import { playIsUnproven, sportModelIsUnproven } from "./provenance";
import type { Play } from "./types";

/**
 * Play-level provenance (Prompt 5). The badge rides the same verdict the
 * trust gate reads: a model-priced play is badged unless its sport's verdict
 * is `trusted`; a play no model priced is never badged. Baked snapshots at
 * the time of writing: MLB marginal, UFC + tennis trusted, soccer no model
 * (same ground truth as trust.test.ts).
 */
function play(over: Partial<Play>): Play {
  return {
    sportKey: "mlb",
    playKey: "k",
    eventRef: "g",
    postedForDate: "2026-10-28",
    startUtc: new Date("2026-10-28T23:00:00Z"),
    selection: { market: null, kind: "ml", side: "home", point: null, label: "Dodgers ML" },
    bestPrice: 110,
    bestBookName: "FanDuel",
    marketEv: 0.01,
    modelEv: 0.04,
    suggestedUnits: 0.5,
    ...over,
  };
}

describe("playIsUnproven", () => {
  const none = new Map<string, string>();
  it("badges a play from a marginal model (MLB)", () => {
    expect(playIsUnproven(play({ sportKey: "mlb" }), none)).toBe(true);
  });
  it("does not badge a play from a trusted model (UFC, tennis)", () => {
    expect(playIsUnproven(play({ sportKey: "ufc" }), none)).toBe(false);
    expect(playIsUnproven(play({ sportKey: "tennis" }), none)).toBe(false);
  });
  it("follows /models when a newer report flips the verdict", () => {
    expect(playIsUnproven(play({ sportKey: "mlb" }), new Map([["mlb", "trusted"]]))).toBe(false);
    expect(playIsUnproven(play({ sportKey: "ufc" }), new Map([["ufc", "unproven"]]))).toBe(true);
  });
  it("badges a model-priced play whose sport has no status at all (soccer)", () => {
    expect(playIsUnproven(play({ sportKey: "soccer" }), none)).toBe(true);
  });
  it("never badges a play no model priced", () => {
    expect(playIsUnproven(play({ sportKey: "mlb", modelEv: null }), none)).toBe(false);
    expect(playIsUnproven(play({ sportKey: "soccer", modelEv: null }), none)).toBe(false);
  });
});

describe("sportModelIsUnproven", () => {
  const none = new Map<string, string>();
  it("reads the sport's verdict, report card first", () => {
    expect(sportModelIsUnproven("mlb", none)).toBe(true);
    expect(sportModelIsUnproven("ufc", none)).toBe(false);
    expect(sportModelIsUnproven("ufc", new Map([["ufc", "thin"]]))).toBe(true);
    expect(sportModelIsUnproven("soccer", none)).toBe(true);
  });
});
