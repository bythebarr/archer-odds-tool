import { describe, expect, it } from "vitest";
import { packTennisLog, parseScore, toTennisLog, unpackTennisLog, type ArchiveMatchRow } from "./matchLog";

const row = (score: string, extra: Partial<ArchiveMatchRow> = {}): ArchiveMatchRow => ({
  tourneyDate: new Date("2026-05-25T00:00:00Z"), tourneyName: "Roland Garros", surface: "Clay", bestOf: 5,
  winnerSackId: "w", winnerName: "Alexander Zverev", winnerRank: 3, loserSackId: "l", loserName: "Flavio Cobolli", loserRank: 20,
  score, minutes: 256, winnerAces: 12, winnerDfs: 3, loserAces: 5, loserDfs: 6,
  winnerSvpt: 140, winnerFirstIn: 90, winnerFirstWon: 70, winnerSecondWon: 28, winnerSvGms: 25, winnerBpSaved: 5, winnerBpFaced: 8,
  loserSvpt: 150, loserFirstIn: 95, loserFirstWon: 60, loserSecondWon: 25, loserSvGms: 24, loserBpSaved: 6, loserBpFaced: 12,
  ...extra,
});

describe("tennis match logs", () => {
  it("parses scores, tiebreaks, retirements and walkovers", () => {
    expect(parseScore("6-1 4-6 6-4 6-7(5) 6-1").sets).toEqual([[6, 1], [4, 6], [6, 4], [6, 7], [6, 1]]);
    expect(parseScore("6-3 2-1 RET")).toMatchObject({ retired: true, sets: [[6, 3], [2, 1]] });
    expect(parseScore("W/O").walkover).toBe(true);
  });

  it("reads a match from each side", () => {
    const w = toTennisLog(row("6-1 4-6 6-4 6-7(5) 6-1"), "w")!;
    expect(w).toMatchObject({ won: true, gamesWon: 28, gamesLost: 19, setsWon: 3, setsLost: 2, aces: 12, breaks: 6, opponent: "Flavio Cobolli" });
    const l = toTennisLog(row("6-1 4-6 6-4 6-7(5) 6-1"), "l")!;
    expect(l).toMatchObject({ won: false, gamesWon: 19, gamesLost: 28, aces: 5, breaks: 3 });
    expect(toTennisLog(row("W/O"), "w")).toBeNull();
    expect(unpackTennisLog(packTennisLog(w))).toEqual(w);
  });
});
