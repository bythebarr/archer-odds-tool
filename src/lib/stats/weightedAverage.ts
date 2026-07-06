/**
 * Weighted average of components that filters out unavailable (null) ones
 * and renormalizes over just the weights that are present, so a metric with
 * a missing input (e.g. no probable pitcher yet) degrades gracefully instead
 * of being computed against a denominator that assumes every input exists.
 * Null only if every component is unavailable.
 */
export function weightedAverage(components: [number | null, number][]): number | null {
  const available = components.filter((c): c is [number, number] => c[0] !== null);
  if (available.length === 0) return null;

  const weightSum = available.reduce((sum, [, w]) => sum + w, 0);
  return available.reduce((sum, [v, w]) => sum + v * w, 0) / weightSum;
}

/** Confidence in [0,1], scaling linearly up to fullConfidenceSampleSize. */
export function sampleConfidence(sampleSize: number, fullConfidenceSampleSize: number): number {
  return Math.min(sampleSize / fullConfidenceSampleSize, 1);
}

/**
 * Shrinks a raw estimate toward an anchor value proportional to confidence
 * (0..1) — used wherever a small sample shouldn't be trusted at full
 * strength (a pitcher's ERA over a few starts, a team's runs rate over a
 * handful of games).
 */
export function shrinkToward(raw: number, anchor: number, confidence: number): number {
  return anchor + confidence * (raw - anchor);
}
