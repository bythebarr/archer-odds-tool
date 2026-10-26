/** Client-safe injury-status rules shared by the props finders and models. */

export type InjuryLevel = "out" | "doubtful" | "questionable" | "probable" | null;

export interface PlayerInjuryInfo {
  status: string;
  detail: string | null;
  level: InjuryLevel;
}

/** ESPN's free-text status → how much it should move a projection. */
export function injuryLevel(status: string | null | undefined): InjuryLevel {
  const s = status?.trim().toLowerCase() ?? "";
  if (!s) return null;
  if (s.startsWith("out") || s.includes("injured reserve") || s === "ir" || s.includes("suspension") || s.includes("pup")) return "out";
  if (s.startsWith("doubtful")) return "doubtful";
  if (s.startsWith("questionable") || s.includes("day-to-day") || s.includes("game-time")) return "questionable";
  if (s.startsWith("probable")) return "probable";
  return null;
}

/** Badge text for a level, and whether a card should treat the prop as off. */
export const INJURY_BADGE: Record<Exclude<InjuryLevel, null>, { label: string; off: boolean }> = {
  out: { label: "OUT", off: true },
  doubtful: { label: "D", off: true },
  questionable: { label: "Q", off: false },
  probable: { label: "P", off: false },
};

/**
 * Extra pull toward 50% for a player who may not play or may be limited:
 * a questionable tag widens the model's uncertainty rather than moving its mean.
 */
export function injuryShrink(level: InjuryLevel): number {
  return level === "questionable" ? 0.7 : level === "doubtful" ? 0.4 : 1;
}
