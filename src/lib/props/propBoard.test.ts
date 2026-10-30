import { describe, expect, it } from "vitest";
import { groupPropBoard, titleOf, type BoardRow } from "./propBoard";

const row = (r: Partial<BoardRow>): BoardRow => ({ athleteId: "1", athleteName: "Ann", market: "Total Shots on Goal", statKey: "shots on goal", period: "game", side: "over", point: 2.5, bookKey: "draftkings", priceAmerican: -120, ...r });

describe("groupPropBoard", () => {
  it("puts a stat's main line, ladder and Yes prop on one card", () => {
    const board = groupPropBoard([
      row({}),
      row({ side: "under", priceAmerican: -105 }),
      row({ market: "Shots on Goal Milestones", point: 3.5, priceAmerican: +150 }),
      row({ market: "Shots on Goal Milestones", point: 1.5, priceAmerican: -400 }),
      row({ market: "Anytime Goalscorer", statKey: "anytime goalscorer", side: "yes", point: 0, priceAmerican: +200 }),
    ]);
    expect(board).toHaveLength(1);
    const sog = board[0].markets.find((m) => m.title === "Shots on Goal")!;
    expect(sog.lines).toEqual([{ point: 2.5, over: [{ bookKey: "draftkings", priceAmerican: -120 }], under: [{ bookKey: "draftkings", priceAmerican: -105 }] }]);
    expect(sog.ladder.map((r) => r.point)).toEqual([1.5, 3.5]);
    expect(board[0].markets.find((m) => m.title === "Anytime Goalscorer")!.yes).toHaveLength(1);
  });

  it("keeps periods apart, full game first", () => {
    const board = groupPropBoard([row({ period: "p1" }), row({})]);
    expect(board[0].markets.map((m) => m.period)).toEqual(["game", "p1"]);
  });

  it("reads book market names as titles", () => {
    expect(titleOf("Total Receiving Yards (incl. overtime)")).toBe("Receiving Yards");
    expect(titleOf("Points Milestones")).toBe("Points");
  });
});
