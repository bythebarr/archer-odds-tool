/**
 * Free historical NFL games loader (nflverse `nfldata/games.csv`) — the data the
 * CLV / beat-the-close backtest needs: every regular-season + playoff game since
 * 1999 with the final result AND the CLOSING market lines (spread, total, and —
 * from 2019 on — moneylines). One consistent stream, zero paid credits.
 *
 * Source: https://github.com/nflverse/nfldata (community-maintained, CC-BY).
 * This is NFL's answer to what tennis-data.co.uk gives tennis: results + closing
 * odds in the same rows, so the backtest builds its Elo and prices its bets off
 * one self-consistent source with no cross-source join.
 *
 * Also carries the game-level matchup-context columns this same file already
 * has but nothing previously read: roof/temp/wind (weather), weekday/gametime
 * (schedule spot — Thursday/Monday night, early/late Sunday), away_rest/
 * home_rest (days since each team's last game), div_game (division-rival
 * familiarity). All confirmed present and populated by fetching real rows
 * before adding these — see `scripts/matchup-nfl-context.ts` for what uses them.
 *
 * Only leading columns are read (all before `stadium`, none of which contain
 * commas), so a plain comma split is safe. (Unlike nflverse's separate
 * play-by-play files, which DO have a comma-bearing free-text column and are
 * deliberately not read this way — see docs/architecture/nfl-adapter.md.)
 */

const GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";

export interface NflGame {
  /** nflverse's own unique id, e.g. "1999_01_MIN_ATL" — season_week_away_home. The dedup/join key; unlike ESPN's per-event ids used elsewhere in this codebase, this one's stable and free of any join risk since it's already this file's sole data source. */
  gameId: string;
  season: number;
  gameType: string; // "REG" | "POST" (older files: "WC"|"DIV"|"CON"|"SB")
  week: number;
  date: Date;
  away: string;
  home: string;
  /** True for a small number of games per season played at neither team's home stadium — international games (London/Germany/Mexico City) and the Super Bowl. "Home"/"Neutral" per nflverse's own `location` column. */
  neutralSite: boolean;
  /** Home margin (home_score − away_score). Positive = home won. null if unplayed. */
  result: number | null;
  /** Raw final scores — needed (not just `result`'s margin) by anything that cares about actual points scored/allowed, e.g. an SRS-style offense/defense split or a totals model. null if unplayed. */
  homeScore: number | null;
  awayScore: number | null;
  /** Closing spread, home perspective: positive = home favored by that many points. */
  spreadLine: number | null;
  /** Closing game total. */
  totalLine: number | null;
  /** Closing American moneylines (present 2019+). */
  homeMoneyline: number | null;
  awayMoneyline: number | null;
  /** "Sunday", "Monday", "Thursday", etc. — nflverse's own `weekday` column. */
  weekday: string;
  /** Local kickoff time, "HH:MM" 24h, as nflverse reports it (not combined into `date`, which stays date-only — unchanged existing behavior). */
  gametime: string | null;
  /** "outdoors" | "dome" | "closed" | "open" | "" (unknown/not recorded, mostly pre-2000s). "closed"/"dome" both mean weather doesn't apply that game. */
  roof: string;
  /** Degrees Fahrenheit at kickoff. null for dome/closed-roof games and some older/unrecorded ones. */
  temp: number | null;
  /** Wind speed, mph, at kickoff. Same nullability as `temp`. nflverse does not record direction (unlike MLB's venue-azimuth wind data) — so wind is used as speed only. */
  wind: number | null;
  /** Days of rest before this game for each team (7 = a normal Sunday-to-Sunday week; 4 = a short week into a Thursday game; 14 = coming off a bye). */
  awayRest: number | null;
  homeRest: number | null;
  /** True if both teams are in the same division. */
  divGame: boolean;
}

const int = (v: string | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const flt = (v: string | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/** Fetch + parse the full nflverse games file. Caller filters/sorts. */
export async function fetchNflGames(): Promise<NflGame[]> {
  const res = await fetch(GAMES_URL);
  if (!res.ok) throw new Error(`nflverse games.csv: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const header = lines[0].split(",").map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);

  const iGameId = col("game_id");
  const iSeason = col("season");
  const iType = col("game_type");
  const iWeek = col("week");
  const iDate = col("gameday");
  const iWeekday = col("weekday");
  const iGametime = col("gametime");
  const iAway = col("away_team");
  const iAwayScore = col("away_score");
  const iHome = col("home_team");
  const iHomeScore = col("home_score");
  const iLocation = col("location");
  const iResult = col("result");
  const iAwayRest = col("away_rest");
  const iHomeRest = col("home_rest");
  const iSpread = col("spread_line");
  const iTotal = col("total_line");
  const iHomeMl = col("home_moneyline");
  const iAwayMl = col("away_moneyline");
  const iDivGame = col("div_game");
  const iRoof = col("roof");
  const iTemp = col("temp");
  const iWind = col("wind");

  const out: NflGame[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(",");
    const gameId = f[iGameId]?.trim();
    const season = int(f[iSeason]);
    const date = f[iDate] ? new Date(f[iDate]) : null;
    const away = f[iAway]?.trim();
    const home = f[iHome]?.trim();
    if (!gameId || season === null || !date || Number.isNaN(date.getTime()) || !away || !home) continue;
    out.push({
      gameId,
      season,
      gameType: f[iType]?.trim() ?? "",
      week: int(f[iWeek]) ?? 0,
      date,
      away,
      home,
      neutralSite: f[iLocation]?.trim() === "Neutral",
      result: int(f[iResult]),
      homeScore: int(f[iHomeScore]),
      awayScore: int(f[iAwayScore]),
      spreadLine: flt(f[iSpread]),
      totalLine: flt(f[iTotal]),
      homeMoneyline: int(f[iHomeMl]),
      awayMoneyline: int(f[iAwayMl]),
      weekday: f[iWeekday]?.trim() ?? "",
      gametime: f[iGametime]?.trim() || null,
      roof: f[iRoof]?.trim() ?? "",
      temp: flt(f[iTemp]),
      wind: flt(f[iWind]),
      awayRest: int(f[iAwayRest]),
      homeRest: int(f[iHomeRest]),
      divGame: f[iDivGame]?.trim() === "1",
    });
  }
  return out;
}
