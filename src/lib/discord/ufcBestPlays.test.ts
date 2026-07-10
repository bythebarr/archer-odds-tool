import { describe, it, expect } from "vitest";
import { pickFromBout } from "./ufcBestPlays";

const bout = {
  id: "b1",
  weightClass: "Lightweight",
  titleBout: false,
  redName: "Red Fighter",
  blueName: "Blue Fighter",
};

describe("pickFromBout", () => {
  it("favors the higher-prob corner and reports its confidence", () => {
    const play = pickFromBout(bout, 0.68, 0.32);
    expect(play).not.toBeNull();
    expect(play!.pickName).toBe("Red Fighter");
    expect(play!.opponentName).toBe("Blue Fighter");
    expect(play!.prob).toBe(0.68);
  });

  it("picks the blue corner when it's favored", () => {
    const play = pickFromBout(bout, 0.35, 0.65);
    expect(play!.pickName).toBe("Blue Fighter");
    expect(play!.prob).toBe(0.65);
  });

  it("drops coin flips below the confidence floor", () => {
    expect(pickFromBout(bout, 0.55, 0.45)).toBeNull(); // 55% < default 0.60 floor
    expect(pickFromBout(bout, 0.6, 0.4)).not.toBeNull(); // exactly at the floor qualifies
  });

  it("respects a custom confidence floor", () => {
    expect(pickFromBout(bout, 0.68, 0.32, 0.7)).toBeNull();
    expect(pickFromBout(bout, 0.72, 0.28, 0.7)).not.toBeNull();
  });

  it("drops a bout the model couldn't price (null prob = thin history)", () => {
    expect(pickFromBout(bout, null, null)).toBeNull();
    expect(pickFromBout(bout, 0.7, null)).toBeNull();
  });
});
