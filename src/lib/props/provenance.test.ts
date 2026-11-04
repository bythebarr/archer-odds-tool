import { describe, it, expect } from "vitest";
import { blendCardKey, blendVerdictsByStat, propBlendVerdict, propIsUnproven } from "./provenance";

/**
 * Props provenance (blend badges). A prop is badged off the BLEND card
 * (`market-blend:<sport>:<stat>`) — the recipe that actually priced it —
 * never the raw model card (`<sport>-props:<stat>`). Only `trusted` is
 * proven; a missing blend card is unproven; a prop with no ARCHR number, or
 * from a sport the blend doesn't price, is never badged.
 */
const prop = (over: Partial<{ sport: string; stat: string; archr: number | null }> = {}) => ({
  sport: "nba",
  stat: "points",
  archr: 0.62,
  ...over,
});

describe("blendCardKey", () => {
  it("names the blend card for a sport and stat", () => {
    expect(blendCardKey("nba", "points")).toBe("market-blend:nba:points");
    expect(blendCardKey("nfl", "passYards")).toBe("market-blend:nfl:passYards");
  });
});

describe("propBlendVerdict", () => {
  it("reads the blend card's verdict", () => {
    const reported = new Map([["market-blend:nba:points", "marginal"]]);
    expect(propBlendVerdict("nba", "points", reported)).toBe("marginal");
  });
  it("is null when only the raw model card exists", () => {
    const reported = new Map([["nba-props:points", "trusted"]]);
    expect(propBlendVerdict("nba", "points", reported)).toBeNull();
  });
  it("is null when no card exists at all", () => {
    expect(propBlendVerdict("nba", "points", new Map())).toBeNull();
  });
});

describe("propIsUnproven", () => {
  it("does not badge a prop whose blend card is trusted", () => {
    const reported = new Map([["market-blend:nba:points", "trusted"]]);
    expect(propIsUnproven(prop(), reported)).toBe(false);
  });
  it("badges a prop whose blend card is marginal, unproven or thin", () => {
    for (const verdict of ["marginal", "unproven", "thin"]) {
      expect(propIsUnproven(prop(), new Map([["market-blend:nba:points", verdict]]))).toBe(true);
    }
  });
  it("badges a prop whose stat has no blend card at all", () => {
    expect(propIsUnproven(prop(), new Map())).toBe(true);
    expect(propIsUnproven(prop({ sport: "mlb", stat: "hits" }), new Map())).toBe(true);
  });
  it("is per stat: a trusted stat rides clean while its neighbour badges", () => {
    const reported = new Map([["market-blend:nba:points", "trusted"]]);
    expect(propIsUnproven(prop({ stat: "points" }), reported)).toBe(false);
    expect(propIsUnproven(prop({ stat: "rebounds" }), reported)).toBe(true);
  });
  it("the blend card governs: a trusted raw card does not rescue an unproven blend", () => {
    const reported = new Map([
      ["nba-props:points", "trusted"],
      ["market-blend:nba:points", "unproven"],
    ]);
    expect(propIsUnproven(prop(), reported)).toBe(true);
  });
  it("the blend card governs: an unproven raw card does not condemn a trusted blend", () => {
    const reported = new Map([
      ["nba-props:points", "unproven"],
      ["market-blend:nba:points", "trusted"],
    ]);
    expect(propIsUnproven(prop(), reported)).toBe(false);
  });
  it("never badges a prop with no ARCHR number", () => {
    expect(propIsUnproven(prop({ archr: null }), new Map())).toBe(false);
  });
  it("never badges a sport the blend does not price", () => {
    expect(propIsUnproven(prop({ sport: "soccer", stat: "goals" }), new Map())).toBe(false);
    expect(propIsUnproven(prop({ sport: "tennis", stat: "aces" }), new Map())).toBe(false);
    expect(propIsUnproven(prop({ sport: "ufc", stat: "sigStrikes" }), new Map())).toBe(false);
  });
});

describe("blendVerdictsByStat", () => {
  it("slices one sport's per-stat verdicts out of the card map", () => {
    const reported = new Map([
      ["market-blend:nba:points", "trusted"],
      ["market-blend:nba:rebounds", "marginal"],
      ["market-blend:nfl:passYards", "unproven"],
      ["nba-props:points", "trusted"],
    ]);
    expect(blendVerdictsByStat("nba", reported)).toEqual({ points: "trusted", rebounds: "marginal" });
    expect(blendVerdictsByStat("nfl", reported)).toEqual({ passYards: "unproven" });
    expect(blendVerdictsByStat("mlb", reported)).toEqual({});
  });
});
