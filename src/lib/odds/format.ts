import type { GameSummary, GameLineRow } from "@/lib/queries/games";
import type { HitRateResult } from "@/lib/queries/hitRate";
import type { RecordSplit } from "@/lib/queries/teamForm";

export const SIDE_LABELS: Record<string, (game: GameSummary) => string> = {
  home: (g) => g.homeTeam.name,
  away: (g) => g.awayTeam.name,
  over: () => "Over",
  under: () => "Under",
};

/**
 * Totals points (e.g. 8.5) aren't signed — only spreads are. A "+" on a
 * totals line reads as a (nonexistent) positive spread, so only add the
 * sign when the market is actually spreads.
 */
export function formatPoint(point: number | null, market: GameLineRow["marketType"]): string {
  if (point === null) return "";
  if (market !== "spreads") return ` ${point}`;
  return point > 0 ? ` +${point}` : ` ${point}`;
}

export function formatHitRate(r: HitRateResult): string {
  if (r.gamesFound === 0) return "no graded games yet";
  const pct = r.hitRate !== null ? `${Math.round(r.hitRate * 100)}%` : "—";
  return `${r.record} (${pct}) last ${r.gamesFound}`;
}

/**
 * `expectedWindow` labels a rolling split (e.g. last5/last10) that hasn't
 * filled up yet — early in a season, `r.gamesFound` can be less than the
 * window, and the caller wants that surfaced rather than silently shown as
 * if it were a full window.
 */
export function formatRecordSplit(r: RecordSplit, expectedWindow?: number): string {
  if (r.gamesFound === 0) return "no games yet";
  if (expectedWindow !== undefined && r.gamesFound < expectedWindow) {
    return `${r.record} (${r.gamesFound} played)`;
  }
  return r.record;
}

export function formatEra(era: number | null): string {
  return era !== null ? era.toFixed(2) : "—";
}

export function formatEv(ev: number | null): string {
  if (ev === null) return "n/a";
  const pct = (ev * 100).toFixed(1);
  return ev >= 0 ? `+${pct}%` : `${pct}%`;
}

export function evColorClass(ev: number | null): string {
  if (ev === null) return "text-muted-foreground";
  return ev >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}
