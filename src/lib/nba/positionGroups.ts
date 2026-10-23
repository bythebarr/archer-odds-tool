/** Client-safe position buckets; the ESPN sync that fills them lives in positions.ts. */

export type PositionGroup = "G" | "F" | "C";

export const POSITION_GROUP_LABEL: Record<PositionGroup, string> = { G: "guards", F: "forwards", C: "centers" };

/** PG/SG/G → G, SF/PF/F → F, C → C; a hybrid (G-F, F-C) takes its first listed spot. */
export function positionGroup(position: string | null | undefined): PositionGroup | null {
  const first = position?.trim().toUpperCase().split(/[-/ ]/)[0];
  if (!first) return null;
  if (first === "PG" || first === "SG" || first === "G") return "G";
  if (first === "SF" || first === "PF" || first === "F") return "F";
  if (first === "C") return "C";
  return null;
}
