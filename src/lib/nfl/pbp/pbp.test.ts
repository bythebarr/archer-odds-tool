import { describe, expect, it } from "vitest";
import { CsvStreamParser, parseCsv } from "./csv";
import { PBP_ALLOWED_COLUMNS, PBP_FORBIDDEN_COLUMNS, toPlay } from "./loader";
import { AsOfRatingBook, METRICS, expectedValue } from "./ratings";
import type { TeamGameObs } from "./teamGames";

describe("CsvStreamParser", () => {
  it("handles quoted commas, escaped quotes, and newlines inside quotes", () => {
    const rows = parseCsv('a,b,c\n1,"x, y","say ""hi"""\n2,"multi\nline",3\n');
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "x, y", 'say "hi"'],
      ["2", "multi\nline", "3"],
    ]);
  });

  it("produces identical rows regardless of chunk boundaries", () => {
    const text = 'h1,h2\n"a,""b""",c\r\nd,"e\nf"';
    const whole = parseCsv(text);
    for (let cut = 1; cut < text.length; cut++) {
      const rows: string[][] = [];
      const p = new CsvStreamParser((r) => rows.push(r));
      p.push(text.slice(0, cut));
      p.push(text.slice(cut));
      p.end();
      expect(rows).toEqual(whole);
    }
  });
});

describe("pbp column allow-list", () => {
  it("never reads final-score or closing-market columns", () => {
    for (const c of PBP_FORBIDDEN_COLUMNS) expect(PBP_ALLOWED_COLUMNS as readonly string[]).not.toContain(c);
  });

  it("drops non-scrimmage rows and normalizes relocated franchise codes", () => {
    const base: Record<string, string> = { pass: "1", rush: "0", posteam: "OAK", defteam: "SD", home_team: "STL", epa: "0.5" };
    const play = toPlay((c) => base[c]);
    expect(play).toMatchObject({ posteam: "LV", defteam: "LAC", homeTeam: "LA", epa: 0.5, pass: true });
    const noScrimmage: Record<string, string> = { ...base, pass: "0" };
    expect(toPlay((c) => noScrimmage[c])).toBeNull();
  });
});

function obs(p: Partial<TeamGameObs>): TeamGameObs {
  return {
    gameId: "g", season: 2020, week: 1, seasonType: "REG", gameDate: "2020-09-13", off: "A", def: "B", offIsHome: true,
    plays: 60, epa: 6, success: 30, passPlays: 35, passEpa: 5, passSuccess: 18, rushPlays: 25, rushEpa: 1, rushSuccess: 12,
    dropbacks: 36, sacks: 2, earlyDownPlays: 40, earlyDownPasses: 20, explosives: 5,
    ...p,
  };
}

describe("AsOfRatingBook", () => {
  const history = [
    obs({ season: 2019, gameDate: "2019-10-01", off: "A", def: "B", epa: 12 }),
    obs({ season: 2019, gameDate: "2019-10-01", off: "B", def: "A", epa: -6 }),
    obs({ season: 2020, week: 1, gameDate: "2020-09-13", off: "A", def: "B", epa: 3 }),
    obs({ season: 2020, week: 1, gameDate: "2020-09-13", off: "B", def: "A", epa: 0 }),
  ];
  const params = { k: 300, carry: 0.5 };

  it("ignores any observation on or after the cutoff (no look-ahead)", () => {
    const cutoff = "2020-09-20";
    const before = new AsOfRatingBook(history, METRICS.epa, params).asOf(2020, cutoff);
    const withFuture = new AsOfRatingBook(
      [...history, obs({ season: 2020, week: 2, gameDate: cutoff, off: "A", def: "B", epa: 60 })],
      METRICS.epa,
      params
    ).asOf(2020, cutoff);
    expect(expectedValue(withFuture, "A", "B")).toBeCloseTo(expectedValue(before, "A", "B"), 12);
  });

  it("uses only the shrunken prior before a season's first game", () => {
    const book = new AsOfRatingBook(history, METRICS.epa, params);
    const wk1 = book.asOf(2020, "2020-09-13");
    // no 2020 data yet: ratings are exactly carry × last season's final
    const final2019 = book.asOf(2019, "2099-01-01");
    expect(wk1.off.get("A")).toBeCloseTo(0.5 * final2019.off.get("A")!, 12);
    // and A's offense (better in 2019) still rates above B's
    expect(wk1.off.get("A")!).toBeGreaterThan(wk1.off.get("B")!);
  });
});
