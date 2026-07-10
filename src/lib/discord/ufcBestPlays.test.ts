import { describe, it, expect } from "vitest";
import { pickFromBout } from "./ufcBestPlays";

const bout = {
  id: "b1",
  weightClass: "Lightweight",
  titleBout: false,
  redId: "red-id",
  redName: "Red Fighter",
  blueId: "blue-id",
  blueName: "Blue Fighter",
};

describe("pickFromBout (Archer EV selection)", () => {
  it("backs the higher-EV (value) side and reports its price/EV", () => {
    // red 52.5% @ +100 → EV +5%; blue 47.5% @ -110 → EV ~-9.3%. Red is the value side.
    const play = pickFromBout(bout, 0.525, 0.475, { priceAmerican: 100, bookKey: "draftkings" }, { priceAmerican: -110, bookKey: "fanduel" });
    expect(play).not.toBeNull();
    expect(play!.side).toBe("red");
    expect(play!.pickName).toBe("Red Fighter");
    expect(play!.pickFighterId).toBe("red-id");
    expect(play!.opponentName).toBe("Blue Fighter");
    expect(play!.bestPrice).toBe(100);
    expect(play!.bestBookName).toBe("draftkings");
    expect(play!.archerEv).toBeCloseTo(0.05, 3);
  });

  it("backs the underdog when the model rates it above the market", () => {
    // blue 52% @ +110 → EV ~+9.2% (the value); red 48% @ -140 → EV negative.
    const play = pickFromBout(bout, 0.48, 0.52, { priceAmerican: -140, bookKey: "betmgm" }, { priceAmerican: 110, bookKey: "draftkings" });
    expect(play!.side).toBe("blue");
    expect(play!.pickName).toBe("Blue Fighter");
    expect(play!.bestPrice).toBe(110);
    expect(play!.archerEv).toBeCloseTo(0.092, 2);
  });

  it("drops plays below the EV floor (no real edge)", () => {
    // best side ~+1% EV, under the 3% floor.
    expect(pickFromBout(bout, 0.505, 0.495, { priceAmerican: 100, bookKey: "dk" }, { priceAmerican: -110, bookKey: "fd" })).toBeNull();
  });

  it("drops plays above the miscalibration ceiling (+20%)", () => {
    // red 70% @ +100 → EV +40%, almost certainly a model/data artifact.
    expect(pickFromBout(bout, 0.7, 0.3, { priceAmerican: 100, bookKey: "dk" }, { priceAmerican: -110, bookKey: "fd" })).toBeNull();
  });

  it("prices the only side that has a line", () => {
    const play = pickFromBout(bout, 0.525, 0.475, { priceAmerican: 100, bookKey: "dk" }, null);
    expect(play!.side).toBe("red");
    const play2 = pickFromBout(bout, 0.475, 0.525, null, { priceAmerican: 100, bookKey: "fd" });
    expect(play2!.side).toBe("blue");
  });

  it("returns null when neither corner has a line (can't price it)", () => {
    expect(pickFromBout(bout, 0.6, 0.4, null, null)).toBeNull();
  });

  it("returns null when the model couldn't price the bout (thin history)", () => {
    expect(pickFromBout(bout, null, null, { priceAmerican: 100, bookKey: "dk" }, { priceAmerican: -110, bookKey: "fd" })).toBeNull();
  });
});
