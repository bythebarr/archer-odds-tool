/**
 * Why an NBA prop lean lost — read AFTER the game, to explain, never to pick
 * (none of this is known before tip). From what was frozen at capture (side,
 * line, projected stat, projected minutes) and what happened (his stat, his
 * minutes, his team's final margin), each settled lean gets the first reason
 * that fits:
 *
 *   lost by a hair      the stat landed within 1 of the line
 *   blowout             a 20+ point final margin, and he played well short of projected
 *   minutes short       6+ minutes under projected (overs need the minutes)
 *   minutes long        6+ minutes over projected (unders get buried by them)
 *   per-minute          minutes about as projected; his output per minute missed the projection
 *   projection miss     the rest: no minutes to read, or none of the above
 *
 * plus two context cuts that apply to wins too, so a reason's share can be read
 * against how often the same thing happens on wins. Pure.
 */

export type LossReason = "lost by a hair" | "blowout" | "minutes short" | "minutes long" | "per-minute" | "projection miss";

export const LOSS_REASONS: LossReason[] = ["lost by a hair", "blowout", "minutes short", "minutes long", "per-minute", "projection miss"];

/** Minutes off projection by this much or more count as a minutes story. */
export const MINUTES_GAP = 6;
/** A final margin this size or more is a blowout. */
export const BLOWOUT = 20;
/** Within this of the line is a hair. */
export const HAIR = 1;

export interface LossInput {
  side: string;
  point: number;
  /** His stat that night. */
  actual: number | null;
  /** Projected minutes frozen at capture. */
  projMinutes: number | null;
  /** Minutes he played. */
  minutes: number | null;
  /** His team's final margin (absolute value is what matters). */
  margin: number | null;
}

export function lossReason(l: LossInput): LossReason {
  if (l.actual !== null && Math.abs(l.actual - l.point) <= HAIR) return "lost by a hair";
  const gap = l.minutes !== null && l.projMinutes !== null ? l.minutes - l.projMinutes : null;
  if (gap !== null && gap <= -MINUTES_GAP && l.margin !== null && Math.abs(l.margin) >= BLOWOUT) return "blowout";
  if (gap !== null && gap <= -MINUTES_GAP && l.side === "over") return "minutes short";
  if (gap !== null && gap >= MINUTES_GAP && l.side === "under") return "minutes long";
  if (gap !== null && Math.abs(gap) < MINUTES_GAP) return "per-minute";
  return "projection miss";
}

/** Minutes vs projection, for every settled lean (wins too). Null without both numbers. */
export function minutesVsProjection(minutes: number | null, projMinutes: number | null): string | null {
  if (minutes === null || projMinutes === null) return null;
  const gap = minutes - projMinutes;
  if (gap <= -MINUTES_GAP) return `${MINUTES_GAP}+ minutes short of projected`;
  if (gap >= MINUTES_GAP) return `${MINUTES_GAP}+ minutes over projected`;
  return `Within ${MINUTES_GAP} minutes of projected`;
}

/** The final margin, for every settled lean. Null without a score. */
export function marginBucket(margin: number | null): string | null {
  if (margin === null) return null;
  const m = Math.abs(margin);
  if (m >= BLOWOUT) return `Blowout (${BLOWOUT}+)`;
  if (m >= 10) return "10–19 points";
  return "Within 9 points";
}

export interface ReasonShare {
  reason: LossReason;
  n: number;
  share: number;
}

/** Each reason's count and share of the losses. */
export function reasonShares(losses: LossInput[]): ReasonShare[] {
  const counts = new Map<LossReason, number>();
  for (const l of losses) {
    const r = lossReason(l);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  return LOSS_REASONS.map((reason) => ({ reason, n: counts.get(reason) ?? 0, share: losses.length ? (counts.get(reason) ?? 0) / losses.length : 0 }));
}
