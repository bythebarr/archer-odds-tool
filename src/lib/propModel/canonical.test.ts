import { describe, expect, it } from "vitest";
import { recordFloor, relativeEdge } from "@/lib/builder/conservative";
import { edgeOf } from "@/lib/builder/types";
import { CANONICAL_NUMBERS, archrChanceOf, cautiousChance, cautiousEdge, edgeFromChance, modelChanceOf } from "./canonical";
import type { PricedProp } from "./price";

const priced = (over: Partial<PricedProp> = {}): PricedProp => ({
  modelProbOver: 0.62,
  market: { probOver: 0.55, books: 6 },
  modelWeight: 0.35,
  weightFitted: false,
  probOver: 0.58,
  probUnder: 0.42,
  evOver: null,
  evUnder: null,
  ...over,
});

describe("canonical numbers", () => {
  it("names five distinct numbers, exactly one of them the headline probability", () => {
    const all = Object.values(CANONICAL_NUMBERS);
    expect(all.map((n) => n.key).sort()).toEqual(["archrChance", "cautiousEdge", "edge", "hitRateProjection", "projection"]);
    expect(new Set(all.map((n) => n.label)).size).toBe(5);
    expect(CANONICAL_NUMBERS.archrChance.kind).toBe("probability");
    expect(CANONICAL_NUMBERS.cautiousEdge.kind).toBe("ranking signal");
    expect(CANONICAL_NUMBERS.projection.kind).toBe("stat value");
  });

  it("ARCHR chance is the blended prob, flipped by side", () => {
    const p = priced();
    expect(archrChanceOf(p, "over")).toBe(0.58);
    expect(archrChanceOf(p, "under")).toBe(0.42);
    // The raw model chance is a different, pre-blend number — never the headline.
    expect(modelChanceOf(p, "over")).toBe(0.62);
    expect(modelChanceOf(p, "under")).toBeCloseTo(0.38);
  });

  it("edge is derived from ARCHR chance alone (identical to the builder's edgeOf)", () => {
    expect(edgeFromChance(0.58, -110)).toBe(edgeOf(0.58, -110));
    expect(edgeFromChance(null, -110)).toBeNull();
    expect(edgeFromChance(0.58, null)).toBeNull();
    // EV at a chance equals that chance's relative edge over the same price — one derivation, two readouts.
    expect(edgeFromChance(0.58, -110)).toBeCloseTo(relativeEdge(0.58, -110)!);
  });

  it("cautious edge is the conservative math, unchanged — min(ARCHR chance, record floor) vs the price", () => {
    const rate: [number, number] = [8, 10];
    expect(cautiousChance(0.68, rate)).toBeCloseTo(Math.min(0.68, recordFloor(8, 10)));
    expect(cautiousEdge(0.68, rate, -110)).toBeCloseTo(relativeEdge(Math.min(0.68, recordFloor(8, 10)), -110)!);
    // Deep-dive worked example: blend 68%, 8-for-10, −110 → cautious edge ≈ +23.9% (plain edge +29.8%).
    expect(cautiousEdge(0.68, rate, -110)!).toBeCloseTo(0.239, 2);
    expect(edgeFromChance(0.68, -110)!).toBeCloseTo(0.298, 2);
    // The cautious read never exceeds the plain edge when the record binds, and equals it when ARCHR chance is the lower input.
    expect(cautiousEdge(0.4, rate, -110)).toBeCloseTo(edgeFromChance(0.4, -110)!);
    expect(cautiousEdge(0.68, rate, null)).toBeNull();
  });
});

describe("one language for the cautious read", () => {
  it("is labeled ranking-only, and its explainer describes the read that is actually live", async () => {
    const { CAUTIOUS_READ_MATH, CAUTIOUS_READ_MODE, cautiousReadMath } = await import("./canonical");
    const { EVIDENCE_PRIOR_GAMES } = await import("./cautiousRead");
    expect(CANONICAL_NUMBERS.cautiousEdge.label).toBe("Cautious edge — ranking only");
    expect(cautiousReadMath).toBe(CAUTIOUS_READ_MATH[CAUTIOUS_READ_MODE]);
    expect(CANONICAL_NUMBERS.cautiousEdge.blurb).toContain(cautiousReadMath);
    expect(CAUTIOUS_READ_MATH["legacy-min"]).toContain("lower of ARCHR chance");
    expect(CAUTIOUS_READ_MATH.evidence).toContain(`against ${EVIDENCE_PRIOR_GAMES} for ARCHR chance`);
  });
});
