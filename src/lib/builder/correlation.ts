/**
 * Same-game correlation in builder pricing (Phase 4, Decision 13).
 *
 * The builder multiplies leg probabilities — pure independence. For legs
 * from DIFFERENT games that's the right model; for legs stacked on the
 * SAME game it is not: they share one game script (one team's pace and
 * minutes feed a QB's yards and his receiver's yards alike), so their
 * joint chance is not the product of their separate chances. The same-
 * game parlay lab (lib/props/parlay.ts) measures exactly this gap —
 * historical co-hit rate vs the independent product — but it works per
 * combination from game logs, and the builder's cached pool carries no
 * joint histories to measure a specific stack with.
 *
 * So builder pricing applies the measured phenomenon as a haircut: each
 * same-game leg beyond the first multiplies the combined chance by
 * SAME_GAME_HAIRCUT. It is a prior in this codebase's usual shape —
 * conservative (never above 1), one knob, documented — and the refit
 * path is named: aggregate the lab's together-vs-independent ratios over
 * posted same-game parlays and set the knob to the measured value.
 */
export const SAME_GAME_HAIRCUT = 0.9;

/** The correlation factor for a set of legs, from their event ids: 0.9 per same-game leg past the first in each event, 1 when every leg is its own game. */
export function sameGameCorrelationFactor(eventIds: string[]): number {
  const counts = new Map<string, number>();
  for (const id of eventIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  let extra = 0;
  for (const n of counts.values()) extra += n - 1;
  return SAME_GAME_HAIRCUT ** extra;
}
