/**
 * American odds ordering is non-linear across the +100/-100 pick'em boundary
 * (there's no valid American value in (-100, 100)), so range filtering/sorting
 * can't compare American odds numbers directly. Decimal odds are a monotonic,
 * continuous stand-in: they increase with bettor-favorability across the whole
 * range and agree at the boundary (+100 and -100 both equal decimal 2.0).
 */
export function americanToDecimal(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

export function formatAmerican(american: number): string {
  return american > 0 ? `+${american}` : `${american}`;
}

export function americanToImpliedProbability(american: number): number {
  return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
}
