import { describe, expect, it } from "vitest";
import { SAME_GAME_HAIRCUT, sameGameCorrelationFactor } from "./correlation";

describe("sameGameCorrelationFactor", () => {
  it("is 1 when every leg is its own game (independence is the right model there)", () => {
    expect(sameGameCorrelationFactor(["g1", "g2", "g3"])).toBe(1);
    expect(sameGameCorrelationFactor([])).toBe(1);
  });

  it("haircuts each same-game leg past the first", () => {
    expect(sameGameCorrelationFactor(["g1", "g1"])).toBeCloseTo(SAME_GAME_HAIRCUT, 10);
    expect(sameGameCorrelationFactor(["g1", "g1", "g1"])).toBeCloseTo(SAME_GAME_HAIRCUT ** 2, 10);
    expect(sameGameCorrelationFactor(["g1", "g1", "g2", "g2"])).toBeCloseTo(SAME_GAME_HAIRCUT ** 2, 10);
    expect(sameGameCorrelationFactor(["g1", "g2", "g1"])).toBeCloseTo(SAME_GAME_HAIRCUT, 10);
  });
});
