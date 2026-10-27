import { describe, expect, it } from "vitest";
import { discreteNormal, lineOutcomeFor, scoreGrid } from "./outcomes";
import { rateLeague, type Result } from "./ratings";

const day = (i: number) => new Date(Date.UTC(2025, 8, 1) + i * 86_400_000);

/** A league where A beats everyone and C loses to everyone. */
function league(scores: [string, string, number, number][]): Result[] {
  return scores.map(([home, away, homeScore, awayScore], i) => ({ date: day(i), home, away, homeScore, awayScore }));
}

describe("score grid", () => {
  it("sums to one", () => {
    const g = scoreGrid(1.6, 1.1, 0.5);
    expect(g.flat().reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });
  it("a discrete normal sums to one and centers on the mean", () => {
    const d = discreteNormal(5.5, 12);
    let z = 0;
    let m = 0;
    for (const [k, p] of d) {
      z += p;
      m += k * p;
    }
    expect(z).toBeCloseTo(1, 9);
    expect(m).toBeCloseTo(5.5, 1);
  });
});

describe("goals family", () => {
  const results: Result[] = [];
  for (let r = 0; r < 12; r++) results.push(...league([["A", "B", 3, 0], ["B", "C", 2, 1], ["C", "A", 0, 2], ["B", "A", 0, 2], ["C", "B", 1, 1], ["A", "C", 4, 0]]));
  const ratings = rateLeague("goals", "soccer", results.map((x, i) => ({ ...x, date: day(i) })));

  it("prices the strong team as favorite, 1X2 summing to one", () => {
    const sides = ["home", "draw", "away"].map((side) => lineOutcomeFor(ratings, "A", "C", { kind: "ml", period: "game", side, team: "", point: 0, threeWay: true }, "soccer")!.win);
    expect(sides.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(sides[0]).toBeGreaterThan(0.6);
  });

  it("splits a quarter handicap across its two halves", () => {
    const q = lineOutcomeFor(ratings, "A", "C", { kind: "spread", period: "game", side: "home", team: "", point: -1.25 }, "soccer")!;
    const a = lineOutcomeFor(ratings, "A", "C", { kind: "spread", period: "game", side: "home", team: "", point: -1 }, "soccer")!;
    const b = lineOutcomeFor(ratings, "A", "C", { kind: "spread", period: "game", side: "home", team: "", point: -1.5 }, "soccer")!;
    expect(q.win).toBeCloseTo((a.win + b.win) / 2, 9);
    expect(q.push).toBeCloseTo(a.push / 2, 9);
  });

  it("over and under on a half-goal line cover everything", () => {
    const o = lineOutcomeFor(ratings, "A", "B", { kind: "total", period: "game", side: "over", team: "", point: 2.5 }, "soccer")!;
    const u = lineOutcomeFor(ratings, "A", "B", { kind: "total", period: "game", side: "under", team: "", point: 2.5 }, "soccer")!;
    expect(o.win + u.win).toBeCloseTo(1, 9);
  });
});

describe("points and winner families", () => {
  const pts: Result[] = [];
  for (let r = 0; r < 15; r++) pts.push(...league([["A", "B", 110, 100], ["B", "C", 105, 100], ["A", "C", 115, 95]]));
  const points = rateLeague("points", "basketball", pts.map((x, i) => ({ ...x, date: day(i) })));

  it("a 2-way moneyline has no push (overtime settles it)", () => {
    const h = lineOutcomeFor(points, "A", "C", { kind: "ml", period: "game", side: "home", team: "", point: 0 }, "basketball")!;
    const a = lineOutcomeFor(points, "A", "C", { kind: "ml", period: "game", side: "away", team: "", point: 0 }, "basketball")!;
    expect(h.push).toBe(0);
    expect(h.win + a.win).toBeCloseTo(1, 6);
    expect(h.win).toBeGreaterThan(0.7);
  });

  it("winner sports price the moneyline only", () => {
    const w = rateLeague("winner", "darts", league([["X", "Y", 6, 2], ["X", "Z", 6, 4], ["Y", "Z", 6, 5]]));
    expect(lineOutcomeFor(w, "X", "Z", { kind: "ml", period: "game", side: "home", team: "", point: 0 }, "darts")!.win).toBeGreaterThan(0.5);
    expect(lineOutcomeFor(w, "X", "Z", { kind: "total", period: "game", side: "over", team: "", point: 10.5 }, "darts")).toBeNull();
  });
});

describe("projectedLine", () => {
  it("rounds a projection to the nearest half-point", async () => {
    const { projectedLine } = await import("@/lib/nba/propsMath");
    expect([24.3, 24.7, 24.5, 0.2, 7.49].map(projectedLine)).toEqual([24.5, 24.5, 24.5, 0.5, 7.5]);
  });
});
