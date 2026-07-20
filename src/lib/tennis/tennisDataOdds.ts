/**
 * Free historical tennis closing-odds loader (tennis-data.co.uk) — the data the
 * CLV / beat-the-close backtest needs and the Sackmann archive lacks. Each yearly
 * file carries every match's result, surface, and CLOSING odds from several books,
 * including Pinnacle (PSW/PSL) — the sharpest line, the gold standard for judging
 * whether a model has real market-beating edge. Zero paid credits.
 *
 * Parsed with SheetJS (the files are .xlsx). Self-contained: results + odds live in
 * the same rows, so the CLV backtest builds its Elo and prices its bets off one
 * consistent stream with no cross-source name join.
 */
import * as XLSX from "xlsx";

const BASE = "http://www.tennis-data.co.uk";

export interface TennisDataMatch {
  date: Date;
  surface: string | null; // "Hard" | "Clay" | "Grass"
  /** tennis-data name form, "Lastname F." — self-consistent within this source. */
  winner: string;
  loser: string;
  /** Pinnacle closing decimal odds for the winner / loser (the sharp line). */
  pinnacleWinner: number | null;
  pinnacleLoser: number | null;
  /** Best (max across sampled books) closing odds — what line-shopping would get. */
  maxWinner: number | null;
  maxLoser: number | null;
  /** Market-average closing decimal odds (typical/conservative reference). */
  avgWinner: number | null;
  avgLoser: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 1 ? n : null;
};

/** ATP files live at /YYYY/YYYY.xlsx, WTA at /YYYYw/YYYY.xlsx. */
function urlFor(tour: "atp" | "wta", year: number): string {
  return tour === "atp" ? `${BASE}/${year}/${year}.xlsx` : `${BASE}/${year}w/${year}.xlsx`;
}

/** Fetch + parse one tour-year of tennis-data closing odds (empty array on 404). */
export async function fetchTennisDataYear(
  tour: "atp" | "wta",
  year: number
): Promise<TennisDataMatch[]> {
  const res = await fetch(urlFor(tour, year));
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`${tour} ${year}: HTTP ${res.status}`);
  const wb = XLSX.read(Buffer.from(await res.arrayBuffer()), { type: "buffer", cellDates: true });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]]);

  const out: TennisDataMatch[] = [];
  for (const r of rows) {
    const date = r.Date instanceof Date ? r.Date : null;
    const winner = typeof r.Winner === "string" ? r.Winner.trim() : "";
    const loser = typeof r.Loser === "string" ? r.Loser.trim() : "";
    // "Comment" flags walkovers/retirements — those results aren't clean model tests.
    const clean = r.Comment === undefined || r.Comment === "Completed";
    if (!date || !winner || !loser || !clean) continue;
    out.push({
      date,
      surface: typeof r.Surface === "string" ? r.Surface.trim() : null,
      winner,
      loser,
      pinnacleWinner: num(r.PSW),
      pinnacleLoser: num(r.PSL),
      maxWinner: num(r.MaxW),
      maxLoser: num(r.MaxL),
      avgWinner: num(r.AvgW),
      avgLoser: num(r.AvgL),
    });
  }
  return out;
}

/** Fetch many tour-years, concatenated (caller sorts). */
export async function fetchTennisData(
  years: number[],
  tours: ("atp" | "wta")[] = ["atp", "wta"]
): Promise<TennisDataMatch[]> {
  const all: TennisDataMatch[] = [];
  for (const tour of tours) {
    for (const year of years) {
      all.push(...(await fetchTennisDataYear(tour, year)));
    }
  }
  return all;
}
