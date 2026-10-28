import { describe, expect, it } from "vitest";
import { usageGames, usageWindow } from "./usage";
import { emptyNflExtras, type NflLogPoint } from "./propsMath";

const log = (targets: number, receptions: number, recYards: number, rushAttempts = 0, rushYards = 0): NflLogPoint => ({
  date: "2026-10-19", opponent: "KC", isHome: true, season: 2026,
  passAttempts: 0, passCompletions: 0, passYards: 0, passTds: 0, interceptions: 0,
  rushAttempts, rushYards, rushTds: 0, receptions, targets, recYards, recTds: 0,
  ...emptyNflExtras(),
});

describe("NFL usage", () => {
  it("reads target and carry share against the team's volume", () => {
    const logs = [log(10, 7, 90, 2, 10), log(6, 4, 50)];
    const vol: [number, number, number][] = [[40, 25, 38], [30, 20, 32]];
    expect(usageGames(logs, vol)[0]).toMatchObject({ targetShare: 0.25, carryShare: 0.08, teamPassAttempts: 38 });
    const w = usageWindow(logs, vol);
    expect(w.targetShare).toBeCloseTo(16 / 70, 6);
    expect(w.catchRate).toBeCloseTo(11 / 16, 6);
    expect(w.yardsPerTarget).toBeCloseTo(140 / 16, 6);
    expect(w.yardsPerCarry).toBe(5);
    expect(w.completionPct).toBeNull();
    expect(w.teamPassAttempts).toBe(35);
  });
});
