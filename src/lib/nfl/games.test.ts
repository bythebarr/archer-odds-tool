import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchNflGames } from "./games";

/** Real nflverse `games.csv` column order, header row only needs the columns this parser actually reads by name — `col()` looks up by header name, not position, so extra/reordered columns elsewhere in the real file don't matter here. */
const HEADER =
  "game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score,location,result,total,overtime,away_rest,home_rest,away_moneyline,home_moneyline,spread_line,total_line,div_game,roof,surface,temp,wind";

function csvRow(fields: Record<string, string>): string {
  return HEADER.split(",")
    .map((h) => fields[h] ?? "")
    .join(",");
}

function mockCsv(text: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, text: async () => text }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchNflGames", () => {
  it("parses a fully-populated row, including the newer weather/rest/schedule-spot/division columns", async () => {
    mockCsv(
      [
        HEADER,
        csvRow({
          game_id: "2024_02_KC_CIN",
          season: "2024",
          game_type: "REG",
          week: "2",
          gameday: "2024-09-15",
          weekday: "Sunday",
          gametime: "13:00",
          away_team: "KC",
          away_score: "17",
          home_team: "CIN",
          home_score: "26",
          location: "Home",
          result: "9",
          away_rest: "7",
          home_rest: "10",
          away_moneyline: "120",
          home_moneyline: "-140",
          spread_line: "-2.5",
          total_line: "47.5",
          div_game: "1",
          roof: "outdoors",
          temp: "78",
          wind: "8",
        }),
      ].join("\n")
    );

    const [g] = await fetchNflGames();
    expect(g).toMatchObject({
      gameId: "2024_02_KC_CIN",
      season: 2024,
      gameType: "REG",
      week: 2,
      away: "KC",
      home: "CIN",
      neutralSite: false,
      result: 9,
      homeScore: 26,
      awayScore: 17,
      awayRest: 7,
      homeRest: 10,
      awayMoneyline: 120,
      homeMoneyline: -140,
      spreadLine: -2.5,
      totalLine: 47.5,
      divGame: true,
      roof: "outdoors",
      temp: 78,
      wind: 8,
      weekday: "Sunday",
      gametime: "13:00",
    });
  });

  it("treats a dome/closed-roof game's missing temp/wind as null, not 0 or NaN", async () => {
    mockCsv(
      [
        HEADER,
        csvRow({
          game_id: "2024_02_DAL_NO",
          season: "2024",
          game_type: "REG",
          week: "2",
          gameday: "2024-09-15",
          weekday: "Sunday",
          away_team: "DAL",
          home_team: "NO",
          away_score: "44",
          home_score: "19",
          result: "-25",
          location: "Home",
          div_game: "0",
          roof: "dome",
        }),
      ].join("\n")
    );

    const [g] = await fetchNflGames();
    expect(g.roof).toBe("dome");
    expect(g.temp).toBeNull();
    expect(g.wind).toBeNull();
    expect(g.divGame).toBe(false);
  });

  it("reads location=Neutral as neutralSite: true", async () => {
    mockCsv(
      [
        HEADER,
        csvRow({
          game_id: "2024_10_JAX_NE",
          season: "2024",
          game_type: "REG",
          week: "10",
          gameday: "2024-11-10",
          weekday: "Sunday",
          away_team: "JAX",
          home_team: "NE",
          away_score: "10",
          home_score: "32",
          result: "22",
          location: "Neutral",
        }),
      ].join("\n")
    );

    const [g] = await fetchNflGames();
    expect(g.neutralSite).toBe(true);
  });
});
