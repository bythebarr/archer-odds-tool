import { describe, it, expect } from "vitest";
import { addLeg, parlayGameKey, parlayHistory, type ParlayLeg, type ParlayLog } from "./parlay";

const g = (date: string, opponent: string, isHome: boolean, value: number | null, season = 2026): ParlayLog => ({ date, opponent, isHome, season, value });

function leg(over: Partial<ParlayLeg>): ParlayLeg {
  return { id: "x", gameId: "tonight", playerName: "P", team: "ATL", statShort: "PTS", side: "over", sideLabel: "Over", point: 10.5, modelProb: null, logs: [], ...over };
}

describe("parlayGameKey", () => {
  it("names a game the same way from both teams", () => {
    expect(parlayGameKey("ATL", { date: "2026-10-28", opponent: "MIA", isHome: true })).toBe("2026-10-28|MIA@ATL");
    expect(parlayGameKey("MIA", { date: "2026-10-28", opponent: "ATL", isHome: false })).toBe("2026-10-28|MIA@ATL");
  });
});

describe("parlayHistory", () => {
  // Two Hawks teammates and a Heat opponent.
  const young = leg({
    id: "young:points",
    point: 24.5,
    logs: [g("2026-10-28", "MIA", true, 30), g("2026-10-26", "BOS", false, 20), g("2026-10-24", "MIA", false, 28), g("2026-10-22", "NYK", true, 26)],
  });
  const johnson = leg({
    id: "johnson:rebounds",
    statShort: "REB",
    point: 7.5,
    logs: [g("2026-10-28", "MIA", true, 9), g("2026-10-26", "BOS", false, 10), g("2026-10-24", "MIA", false, 5), g("2026-10-20", "CHA", true, 12)],
  });
  const adebayo = leg({
    id: "adebayo:points",
    team: "MIA",
    point: 15.5,
    side: "under",
    sideLabel: "Under",
    logs: [g("2026-10-28", "ATL", false, 12), g("2026-10-24", "ATL", true, 14), g("2026-10-22", "ORL", true, 30)],
  });

  it("teammates: counts only the games both played, and the ones both cashed", () => {
    const h = parlayHistory([young, johnson], 2026);
    expect(h.games.map((x) => x.date)).toEqual(["2026-10-28", "2026-10-26", "2026-10-24"]); // 10-22 and 10-20 aren't shared
    expect(h.games.map((x) => x.legs)).toEqual([[true, true], [false, true], [true, false]]);
    expect(h.together).toEqual({ hits: 1, sampleSize: 3, hitRate: 1 / 3 });
    expect(h.perLeg.map((r) => r.hits)).toEqual([2, 2]);
    expect(h.independent).toBeCloseTo((2 / 3) * (2 / 3));
  });

  it("opponents: matches the head-to-head games only", () => {
    const h = parlayHistory([young, johnson, adebayo], 2026);
    expect(h.games.map((x) => x.matchup)).toEqual(["MIA@ATL", "ATL@MIA"]);
    expect(h.games.map((x) => x.all)).toEqual([true, false]);
    expect(h.together.hits).toBe(1);
  });

  it("skips a game where a leg's stat wasn't recorded", () => {
    const missing = leg({ ...johnson, logs: johnson.logs.map((l) => (l.date === "2026-10-28" ? { ...l, value: null } : l)) });
    expect(parlayHistory([young, missing], 2026).games.map((x) => x.date)).toEqual(["2026-10-26", "2026-10-24"]);
  });

  it("windows by this season, and multiplies ARCHR's chances only when every leg has one", () => {
    const old = leg({ ...young, logs: [...young.logs, g("2025-12-01", "MIA", true, 40, 2025)] });
    const old2 = leg({ ...johnson, logs: [...johnson.logs, g("2025-12-01", "MIA", true, 11, 2025)] });
    const h = parlayHistory([old, old2], 2026);
    expect(h.together.sampleSize).toBe(4);
    expect(h.thisSeason.sampleSize).toBe(3);
    expect(h.model).toBeNull();
    expect(parlayHistory([{ ...young, modelProb: 0.5 }, { ...johnson, modelProb: 0.6 }], 2026).model).toBeCloseTo(0.3);
  });

  it("an empty parlay has nothing to count", () => {
    const h = parlayHistory([], 2026);
    expect(h.together).toEqual({ hits: 0, sampleSize: 0, hitRate: null });
    expect(h.independent).toBeNull();
  });
});

describe("addLeg", () => {
  const a = leg({ id: "a:points" });
  const b = leg({ id: "b:points" });
  it("appends a new leg, and replaces the same player's stat with the new line", () => {
    expect(addLeg([a], b).map((l) => l.id)).toEqual(["a:points", "b:points"]);
    expect(addLeg([a, b], { ...a, point: 20.5 }).map((l) => l.point)).toEqual([20.5, 10.5]);
  });
  it("a leg from another game starts a new parlay", () => {
    expect(addLeg([a, b], leg({ id: "c:points", gameId: "other" })).map((l) => l.id)).toEqual(["c:points"]);
  });
});

describe("traded players", () => {
  it("matches a game by the team the player was on that night, not his current one", () => {
    // Dort is a Hawk now, but last season's head-to-heads with Mitchell were for OKC.
    const dort = leg({ id: "dort:points", team: "ATL", logs: [g("2026-02-10", "CLE", true, 12), g("2026-10-27", "MIA", true, 8)].map((l, i) => ({ ...l, team: i === 0 ? "OKC" : "ATL" })) });
    const mitchell = leg({ id: "mitchell:points", team: "CLE", point: 25.5, logs: [{ ...g("2026-02-10", "OKC", false, 30), team: "CLE" }] });
    const h = parlayHistory([dort, mitchell], 2026);
    expect(h.games.map((x) => x.matchup)).toEqual(["CLE@OKC"]);
    expect(h.together.hits).toBe(1);
  });
});
