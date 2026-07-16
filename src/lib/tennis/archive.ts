/**
 * Free tennis history import — the training + backtest base for the surface-aware
 * Elo model. Pulls Jeff Sackmann's public ATP/WTA match CSVs (decades of results
 * with surface, round, rank, and stable player ids) from a current GitHub mirror
 * and upserts them into `TennisArchiveMatch`. Zero Odds API credits — pure free
 * data, exactly the on-budget path the every-sport mandate needs for a real model.
 *
 * Matches are immutable once played, so re-running only ADDS newly-completed
 * matches (createMany + skipDuplicates on the natural key); a weekly refresh of the
 * current year keeps ratings live. See scripts/import-tennis-archive.ts.
 */
import { prisma } from "@/lib/prisma";

/** Raw base of the Sackmann archive mirror (the canonical JeffSackmann repo 404s now). */
const MIRROR = "https://raw.githubusercontent.com/Aneeshers/tennis-sackmann-archive/main";

export type Tour = "atp" | "wta";

/** Lowercased, accent-stripped, space-collapsed — the join key to live Odds API names. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[.\-']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Minimal RFC-4180-ish CSV parser (handles quoted fields + embedded commas/quotes).
 * The Sackmann files are simple, but a real parser costs little and avoids a bad
 * split silently corrupting a name or score.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const toInt = (v: string | undefined): number | null => {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

/** Sackmann tourney_date is YYYYMMDD; parse to a UTC Date (midnight). */
function parseYmd(v: string | undefined): Date | null {
  if (!v || v.length < 8) return null;
  const y = +v.slice(0, 4);
  const m = +v.slice(4, 6);
  const d = +v.slice(6, 8);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

export interface ArchiveRow {
  tour: Tour;
  tourneyId: string;
  tourneyName: string;
  surface: string | null;
  tourneyLevel: string | null;
  round: string | null;
  tourneyDate: Date;
  matchNum: number;
  bestOf: number | null;
  winnerSackId: string;
  winnerName: string;
  winnerNorm: string;
  winnerRank: number | null;
  winnerRankPoints: number | null;
  winnerAces: number | null;
  winnerDfs: number | null;
  loserSackId: string;
  loserName: string;
  loserNorm: string;
  loserRank: number | null;
  loserRankPoints: number | null;
  loserAces: number | null;
  loserDfs: number | null;
  score: string | null;
}

/** Fetch + parse one tour-year CSV into typed rows (skips rows missing the key fields). */
export async function fetchSackmannYear(tour: Tour, year: number): Promise<ArchiveRow[]> {
  const url = `${MIRROR}/${tour}/${tour}_matches_${year}.csv`;
  const res = await fetch(url);
  if (res.status === 404) return []; // year not published yet — not an error
  if (!res.ok) throw new Error(`${tour} ${year}: HTTP ${res.status}`);
  const rows = parseCsv(await res.text());
  if (rows.length < 2) return [];

  const header = rows[0];
  const col = (name: string) => header.indexOf(name);
  const idx = {
    tourneyId: col("tourney_id"),
    tourneyName: col("tourney_name"),
    surface: col("surface"),
    level: col("tourney_level"),
    round: col("round"),
    date: col("tourney_date"),
    matchNum: col("match_num"),
    bestOf: col("best_of"),
    wId: col("winner_id"),
    wName: col("winner_name"),
    wRank: col("winner_rank"),
    wPts: col("winner_rank_points"),
    wAce: col("w_ace"),
    wDf: col("w_df"),
    lId: col("loser_id"),
    lName: col("loser_name"),
    lRank: col("loser_rank"),
    lPts: col("loser_rank_points"),
    lAce: col("l_ace"),
    lDf: col("l_df"),
    score: col("score"),
  };

  const out: ArchiveRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const f = rows[r];
    const matchNum = toInt(f[idx.matchNum]);
    const date = parseYmd(f[idx.date]);
    const wId = f[idx.wId];
    const lId = f[idx.lId];
    const wName = f[idx.wName];
    const lName = f[idx.lName];
    if (matchNum === null || !date || !wId || !lId || !wName || !lName) continue;
    const surface = f[idx.surface]?.trim() || null;
    out.push({
      tour,
      tourneyId: f[idx.tourneyId] ?? "",
      tourneyName: f[idx.tourneyName] ?? "",
      surface,
      tourneyLevel: f[idx.level]?.trim() || null,
      round: f[idx.round]?.trim() || null,
      tourneyDate: date,
      matchNum,
      bestOf: toInt(f[idx.bestOf]),
      winnerSackId: wId,
      winnerName: wName,
      winnerNorm: normalizeName(wName),
      winnerRank: toInt(f[idx.wRank]),
      winnerRankPoints: toInt(f[idx.wPts]),
      winnerAces: toInt(f[idx.wAce]),
      winnerDfs: toInt(f[idx.wDf]),
      loserSackId: lId,
      loserName: lName,
      loserNorm: normalizeName(lName),
      loserRank: toInt(f[idx.lRank]),
      loserRankPoints: toInt(f[idx.lPts]),
      loserAces: toInt(f[idx.lAce]),
      loserDfs: toInt(f[idx.lDf]),
      score: f[idx.score]?.trim() || null,
    });
  }
  return out;
}

export interface ImportSummary {
  fetched: number;
  inserted: number;
  perYear: Record<string, number>;
}

/**
 * Import a span of tour-years into `TennisArchiveMatch`. Immutable-match semantics:
 * createMany + skipDuplicates on the (tour, tourneyId, matchNum) natural key, so a
 * re-run only inserts newly-completed matches.
 */
export async function importTennisArchive(
  { years, tours = ["atp", "wta"] }: { years: number[]; tours?: Tour[] }
): Promise<ImportSummary> {
  const summary: ImportSummary = { fetched: 0, inserted: 0, perYear: {} };
  for (const tour of tours) {
    for (const year of years) {
      const rows = await fetchSackmannYear(tour, year);
      summary.fetched += rows.length;
      let inserted = 0;
      // Chunk to keep the insert statement well under param limits.
      for (let i = 0; i < rows.length; i += 1000) {
        const res = await prisma.tennisArchiveMatch.createMany({
          data: rows.slice(i, i + 1000),
          skipDuplicates: true,
        });
        inserted += res.count;
      }
      summary.inserted += inserted;
      summary.perYear[`${tour}_${year}`] = inserted;
    }
  }
  return summary;
}
