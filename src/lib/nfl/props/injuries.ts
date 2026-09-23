/**
 * The official NFL injury report (nflverse `injuries` release, 2009+), reduced
 * to what's knowable before kickoff: each player's final game-status
 * designation for the week. The report is published Friday (Wednesday–Thursday
 * for Thursday games), so `Out`/`Doubtful` is legitimate pregame information.
 *
 * Measured on 2025 skill players: 0% of `Out` and 0% of `Doubtful` players
 * took a snap; 59% of `Questionable` players did. So Out/Doubtful are treated
 * as absent and Questionable as uncertain. Players on injured reserve aren't
 * on the weekly report at all; their absence is already reflected in teammates'
 * lagged shares, since they stopped playing weeks ago.
 *
 * Older seasons are published only as plain `.csv`; newer ones also as `.gz`.
 */
import { loadReleaseCsv } from "../nflverse";
import { franchise } from "../pbp/franchise";

export type ReportStatus = "Out" | "Doubtful" | "Questionable";

export interface InjuryEntry {
  playerId: string;
  team: string;
  position: string;
  status: ReportStatus;
}

const COLUMNS = ["season", "week", "game_type", "team", "gsis_id", "position", "report_status"] as const;

/** `${season}|${week}` → entries with a game-status designation. */
export type InjuryIndex = Map<string, InjuryEntry[]>;

export const injuryKey = (season: number, week: number) => `${season}|${week}`;

export async function loadInjuryReports(fromSeason: number, toSeason: number): Promise<InjuryIndex> {
  const index: InjuryIndex = new Map();
  for (let season = fromSeason; season <= toSeason; season++) {
    const rows =
      (await loadReleaseCsv("injuries", `injuries_${season}.csv.gz`, COLUMNS)) ??
      (await loadReleaseCsv("injuries", `injuries_${season}.csv`, COLUMNS)) ??
      [];
    for (const r of rows) {
      if (r.game_type !== "REG") continue;
      const status = r.report_status;
      if (status !== "Out" && status !== "Doubtful" && status !== "Questionable") continue;
      const key = injuryKey(season, Number(r.week));
      const list = index.get(key) ?? index.set(key, []).get(key)!;
      list.push({ playerId: r.gsis_id, team: franchise(r.team), position: r.position === "FB" ? "RB" : r.position, status });
    }
  }
  return index;
}

/** Players ruled out (Out or Doubtful) for a team in a week. */
export function ruledOut(index: InjuryIndex, season: number, week: number, team: string): InjuryEntry[] {
  return (index.get(injuryKey(season, week)) ?? []).filter((e) => e.team === team && (e.status === "Out" || e.status === "Doubtful"));
}
