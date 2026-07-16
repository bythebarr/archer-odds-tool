/**
 * Free historical soccer loader (football-data.co.uk) — the soccer twin of the
 * tennis-data.co.uk feed we already use (same publisher). Each league-season file
 * carries every match's full-time goals AND closing 1X2 odds from several books,
 * including Pinnacle (PSC*) — the sharp line. That's exactly what the two honest
 * tests need: goals to TRAIN the Poisson model, closing odds to run the CLV /
 * beat-the-close backtest. Zero paid credits.
 *
 * Files live at /mmz4281/{season}/{div}.csv, season code "2425" = 2024–25.
 * Only leading + named columns are read; football-data team names carry no commas,
 * so a plain comma split is safe.
 */

const BASE = "https://www.football-data.co.uk/mmz4281";

/** The big-five leagues + English Championship — deep, liquid, well-covered. */
export const DEFAULT_DIVS = ["E0", "E1", "D1", "SP1", "I1", "F1"];

export interface SoccerMatch {
  div: string;
  /** Season the file belongs to, as the starting year (2425 → 2024). */
  season: number;
  date: Date;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  result: "H" | "D" | "A";
  /** Pinnacle closing decimal odds (sharp line) for home / draw / away. */
  psH: number | null;
  psD: number | null;
  psA: number | null;
  /** Market MAX closing odds — what line-shopping would get. */
  maxH: number | null;
  maxD: number | null;
  maxA: number | null;
  /** Market AVERAGE closing odds — conservative reference. */
  avgH: number | null;
  avgD: number | null;
  avgA: number | null;
}

const odds = (v: string | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 1 ? n : null;
};

/** football-data dates are DD/MM/YYYY (older files DD/MM/YY). */
function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const [d, m, y] = s.split("/");
  if (!d || !m || !y) return null;
  const year = y.length === 2 ? 2000 + parseInt(y, 10) : parseInt(y, 10);
  const dt = new Date(Date.UTC(year, parseInt(m, 10) - 1, parseInt(d, 10)));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Fetch + parse one league-season file (empty array on 404). */
export async function fetchFootballDataFile(season: string, div: string): Promise<SoccerMatch[]> {
  const res = await fetch(`${BASE}/${season}/${div}.csv`);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`${div} ${season}: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!lines.length) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const c = (name: string) => header.indexOf(name);
  const at = (f: string[], name: string): string | undefined => {
    const i = c(name);
    return i < 0 ? undefined : f[i];
  };
  const seasonYear = 2000 + parseInt(season.slice(0, 2), 10);

  const out: SoccerMatch[] = [];
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].split(",");
    const date = parseDate(at(f, "Date"));
    const home = at(f, "HomeTeam")?.trim();
    const away = at(f, "AwayTeam")?.trim();
    const hg = at(f, "FTHG");
    const ag = at(f, "FTAG");
    const ftr = at(f, "FTR")?.trim();
    if (!date || !home || !away || hg === undefined || ag === undefined || hg === "" || ag === "") continue;
    if (ftr !== "H" && ftr !== "D" && ftr !== "A") continue;
    out.push({
      div,
      season: seasonYear,
      date,
      home,
      away,
      homeGoals: parseInt(hg, 10),
      awayGoals: parseInt(ag, 10),
      result: ftr,
      psH: odds(at(f, "PSCH")),
      psD: odds(at(f, "PSCD")),
      psA: odds(at(f, "PSCA")),
      maxH: odds(at(f, "MaxCH")),
      maxD: odds(at(f, "MaxCD")),
      maxA: odds(at(f, "MaxCA")),
      avgH: odds(at(f, "AvgCH")),
      avgD: odds(at(f, "AvgCD")),
      avgA: odds(at(f, "AvgCA")),
    });
  }
  return out;
}

/** Fetch many league-seasons, concatenated (caller sorts). */
export async function fetchFootballData(
  seasons: string[],
  divs: string[] = DEFAULT_DIVS
): Promise<SoccerMatch[]> {
  const all: SoccerMatch[] = [];
  for (const div of divs) {
    for (const season of seasons) {
      all.push(...(await fetchFootballDataFile(season, div)));
    }
  }
  return all;
}
