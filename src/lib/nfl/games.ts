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
 * Only leading columns are read (all before `stadium`, none of which contain
 * commas), so a plain comma split is safe.
 */

const GAMES_URL = "https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv";

export interface NflGame {
  season: number;
  gameType: string; // "REG" | "POST" (older files: "WC"|"DIV"|"CON"|"SB")
  week: number;
  date: Date;
  away: string;
  home: string;
  /** Home margin (home_score − away_score). Positive = home won. null if unplayed. */
  result: number | null;
  /** Closing spread, home perspective: positive = home favored by that many points. */
  spreadLine: number | null;
  /** Closing game total. */
  totalLine: number | null;
  /** Closing American moneylines (present 2019+). */
  homeMoneyline: number | null;
  awayMoneyline: number | null;
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

  const iSeason = col("season");
  const iType = col("game_type");
  const iWeek = col("week");
  const iDate = col("gameday");
  const iAway = col("away_team");
  const iHome = col("home_team");
  const iResult = col("result");
  const iSpread = col("spread_line");
  const iTotal = col("total_line");
  const iHomeMl = col("home_moneyline");
  const iAwayMl = col("away_moneyline");

  const out: NflGame[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(",");
    const season = int(f[iSeason]);
    const date = f[iDate] ? new Date(f[iDate]) : null;
    const away = f[iAway]?.trim();
    const home = f[iHome]?.trim();
    if (season === null || !date || Number.isNaN(date.getTime()) || !away || !home) continue;
    out.push({
      season,
      gameType: f[iType]?.trim() ?? "",
      week: int(f[iWeek]) ?? 0,
      date,
      away,
      home,
      result: int(f[iResult]),
      spreadLine: flt(f[iSpread]),
      totalLine: flt(f[iTotal]),
      homeMoneyline: int(f[iHomeMl]),
      awayMoneyline: int(f[iAwayMl]),
    });
  }
  return out;
}
