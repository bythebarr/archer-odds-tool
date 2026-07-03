import type { GameSummary } from "@/lib/queries/games";
import type { HitRateResult } from "@/lib/queries/hitRate";

export const SIDE_LABELS: Record<string, (game: GameSummary) => string> = {
  home: (g) => g.homeTeam.name,
  away: (g) => g.awayTeam.name,
  over: () => "Over",
  under: () => "Under",
};

export function formatPoint(point: number | null): string {
  if (point === null) return "";
  return point > 0 ? ` +${point}` : ` ${point}`;
}

export function formatHitRate(r: HitRateResult): string {
  if (r.gamesFound === 0) return "no graded games yet";
  const pct = r.hitRate !== null ? `${Math.round(r.hitRate * 100)}%` : "—";
  return `${r.record} (${pct}) last ${r.gamesFound}`;
}

export function formatEv(ev: number | null): string {
  if (ev === null) return "n/a";
  const pct = (ev * 100).toFixed(1);
  return ev >= 0 ? `+${pct}%` : `${pct}%`;
}

export function evColorClass(ev: number | null): string {
  if (ev === null) return "text-zinc-400";
  return ev >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}
