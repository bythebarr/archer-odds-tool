import type { PropBoard, PropSport, SportPropConfig } from "./boardTypes";
import { mlbPropConfig } from "./mlbBoard";

/**
 * The sport registry — the one place a new sport is wired in. Add its
 * SportPropConfig here and it appears on the universal board with its own
 * views, stat catalogs, alt-lines, and split columns. Nothing else changes.
 */
export const PROP_SPORTS: Record<PropSport, SportPropConfig> = {
  mlb: mlbPropConfig,
};

export function listPropSports(): SportPropConfig[] {
  return Object.values(PROP_SPORTS);
}

export function isPropSport(value: string): value is PropSport {
  return value in PROP_SPORTS;
}

/**
 * Build the board for one sport/view/date/stat. Generic over the registry —
 * the page and UI never mention a specific sport or view.
 */
export async function getPropBoard(
  sport: PropSport,
  dateEt: string,
  viewKey?: string,
  statKey?: string
): Promise<PropBoard> {
  const config = PROP_SPORTS[sport];
  const view = config.views.find((v) => v.key === viewKey) ?? config.views[0];
  const activeStat = view.stats.find((s) => s.key === statKey) ?? view.stats[0];
  const rows = await view.buildBoard(dateEt, activeStat.key);

  return {
    sport,
    date: dateEt,
    views: config.views.map(({ key, label }) => ({ key, label })),
    activeView: view.key,
    stats: view.stats.map(({ key, label, shortLabel, role }) => ({ key, label, shortLabel, role })),
    activeStatKey: activeStat.key,
    lines: activeStat.standardLines,
    columns: view.columns,
    rows,
  };
}
