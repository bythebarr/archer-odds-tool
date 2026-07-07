import type { StatCategory } from "@/generated/prisma/client";

const STAT_CATEGORIES: StatCategory[] = [
  "hits",
  "totalBases",
  "homeRuns",
  "rbi",
  "runs",
  "battingStrikeouts",
  "pitcherStrikeouts",
  "earnedRuns",
  "hitsAllowed",
  "walksAllowed",
  "outsRecorded",
];

export function parseStatCategory(value: string | null): StatCategory | undefined {
  return STAT_CATEGORIES.find((c) => c === value);
}

export function parseDirection(value: string | null): "over" | "under" | undefined {
  if (value === "over" || value === "under") return value;
  return undefined;
}
