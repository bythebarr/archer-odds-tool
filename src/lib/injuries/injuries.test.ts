import { describe, expect, it } from "vitest";
import { parseEspnInjuries } from "./espnInjuries";
import { injuryLevel, injuryShrink } from "./status";

describe("parseEspnInjuries", () => {
  it("reads team blocks, ids from the field or the profile link, and a short detail", () => {
    const out = parseEspnInjuries({
      injuries: [
        {
          displayName: "Philadelphia 76ers",
          injuries: [
            { status: "Out", athlete: { id: "3059318", displayName: "Joel Embiid" }, details: { type: "Knee", returnDate: "2026-11-05" } },
            { status: "Day-To-Day", athlete: { displayName: "Tyrese Maxey", links: [{ href: "https://www.espn.com/nba/player/_/id/4431678/tyrese-maxey" }] }, shortComment: "Ankle soreness." },
            { status: "Out", athlete: { displayName: "No Id" } },
          ],
        },
      ],
    });
    expect(out).toEqual([
      { espnAthleteId: "3059318", playerName: "Joel Embiid", teamName: "Philadelphia 76ers", status: "Out", detail: "Knee · back ~11/05" },
      { espnAthleteId: "4431678", playerName: "Tyrese Maxey", teamName: "Philadelphia 76ers", status: "Day-To-Day", detail: "Ankle soreness." },
    ]);
  });
  it("survives junk", () => {
    expect(parseEspnInjuries(null)).toEqual([]);
  });
});

describe("injuryLevel", () => {
  it("maps ESPN statuses", () => {
    expect(["Out", "Injured Reserve", "Doubtful", "Questionable", "Day-To-Day", "Probable", "Active"].map(injuryLevel)).toEqual([
      "out",
      "out",
      "doubtful",
      "questionable",
      "questionable",
      "probable",
      null,
    ]);
  });
  it("widens uncertainty for questionable", () => {
    expect(injuryShrink("questionable")).toBeLessThan(1);
    expect(injuryShrink(null)).toBe(1);
  });
});

import { gamesWithout, withoutWeight } from "./absence";

describe("gamesWithout", () => {
  const logs = ["2026-10-01", "2026-10-03", "2026-10-05", "2026-10-07", "2026-09-01"].map((date) => ({ date }));
  it("keeps games since they shared the team that every absent player missed", () => {
    const out = gamesWithout(logs, [{ name: "A", status: "Out", playedDates: ["2026-10-01", "2026-10-05"], usage: 30 }]);
    expect(out.map((l) => l.date)).toEqual(["2026-10-03", "2026-10-07"]);
  });
  it("requires every absent player to have missed the game", () => {
    const out = gamesWithout(logs, [
      { name: "A", status: "Out", playedDates: ["2026-10-01"], usage: 30 },
      { name: "B", status: "Out", playedDates: ["2026-10-03", "2026-10-01"], usage: 25 },
    ]);
    expect(out.map((l) => l.date)).toEqual(["2026-10-05", "2026-10-07"]);
  });
  it("weights by sample", () => {
    expect(withoutWeight(5, 5)).toBe(0.5);
    expect(gamesWithout(logs, [])).toEqual([]);
  });
});
