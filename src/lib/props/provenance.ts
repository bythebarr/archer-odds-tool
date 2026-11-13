/**
 * Props provenance (display only). A prop's ARCHR number is priced by the
 * market blend (lib/propModel's priceProp): the model's logit blended with
 * the books' de-vigged consensus, at a weight fitted per sport and stat.
 * The report card that grades that exact recipe is
 * `market-blend:<sport>:<stat>` (saved by `npm run backtest:props-market`) —
 * NOT the raw model card (`<sport>-props:<stat>`), which grades the model
 * alone and already does its real job inside the pipeline, fitting the
 * shrink. So a prop's badge reads the blend card's verdict, resolved through
 * the same trust source the gate reads (lib/engine/trust.ts), so the label
 * and the gate can't disagree. Nothing here filters, ranks, or reprices a
 * prop; it only labels what already shows.
 */
import { isUnprovenVerdict } from "../modelBadge";
import { trustVerdict, type ReportedVerdicts } from "../engine/trust";

/**
 * Sports whose props are priced by the market blend (priceProp prices NBA,
 * NFL and MLB props). Soccer, UFC and tennis props come from their own
 * projection models with no market blend in the price, so no blend verdict
 * applies to them and they are never badged from one.
 */
export const BLEND_PRICED_PROP_SPORTS: ReadonlySet<string> = new Set(["nba", "nfl", "mlb"]);

/** The /models report card that grades the blend a <sport> <stat> prop is priced with. */
export function blendCardKey(sport: string, stat: string): string {
  return `market-blend:${sport}:${stat}`;
}

/**
 * The blend card's verdict for a stat: its latest saved report when one
 * exists, else null (blend cards have no baked snapshot to fall back to).
 * Only `trusted` counts as proven (see lib/modelBadge).
 */
export function propBlendVerdict(sport: string, stat: string, reported: ReportedVerdicts): string | null {
  return trustVerdict(blendCardKey(sport, stat), reported);
}

/**
 * Whether a blend-priced prop should carry the unproven badge. A prop with
 * no ARCHR number (`archr` null) makes no blend claim, so it is never
 * badged; a sport the blend doesn't price is never badged from a blend card;
 * otherwise the prop is badged unless its blend card's verdict is `trusted`
 * — a stat with no blend card at all is unproven, never assumed proven.
 */
export function propIsUnproven(prop: { sport: string; stat: string; archr: number | null }, reported: ReportedVerdicts): boolean {
  if (prop.archr === null) return false;
  if (!BLEND_PRICED_PROP_SPORTS.has(prop.sport)) return false;
  return isUnprovenVerdict(propBlendVerdict(prop.sport, prop.stat, reported));
}

/**
 * One sport's blend verdicts as a stat → verdict record, for threading to
 * the client components (the finders and player sheets) alongside the model
 * weights. A stat absent from the record has no blend card — unproven.
 */
export function blendVerdictsByStat(sport: string, reported: ReportedVerdicts): Record<string, string> {
  const prefix = `market-blend:${sport}:`;
  const out: Record<string, string> = {};
  for (const [key, verdict] of reported) {
    if (key.startsWith(prefix)) out[key.slice(prefix.length)] = verdict;
  }
  return out;
}

/** One sport's blend-card graded counts as stat → n (see getReportedGraded). */
export function blendGradedByStat<T>(sport: string, graded: Record<string, T>): Record<string, T> {
  const prefix = `market-blend:${sport}:`;
  const out: Record<string, T> = {};
  for (const [key, n] of Object.entries(graded)) if (key.startsWith(prefix)) out[key.slice(prefix.length)] = n;
  return out;
}
