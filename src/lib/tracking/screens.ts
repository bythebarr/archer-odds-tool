/**
 * Named screener sets tracked forward (Phase: "is the recommended set still
 * hitting?"). Each lean records, when it is frozen, which of these screener
 * filter sets it passes — run through the screener's own `passes`
 * (lib/screener/types), so a set here is exactly what the screener shows with
 * those filters on. The edge tracker then cuts settled leans by set: the set's
 * record going forward, out of sample, not a look back. Pure.
 *
 * Add a set by adding an entry; never rename a key (settled leans carry it).
 */
import { DEFAULT_FILTERS, passes, type ScreenFilters, type ScreenerProp } from "@/lib/screener/types";

export interface TrackedScreen {
  key: string;
  label: string;
  filters: ScreenFilters;
}

export const TRACKED_SCREENS: TrackedScreen[] = [
  {
    // docs/filter-sweep.md: the highest hit rate that held up in both halves (Model lab run #96).
    key: "most-accurate-v1",
    label: "Most accurate: L5 80%+ · unders · −200 to +100 · minutes 24+ · ARCHR's side",
    filters: { ...DEFAULT_FILTERS, min: { l5: 0.8 }, side: "under", shortest: -200, longest: 100, minMinutes: 24, archrSide: true },
  },
  {
    // docs/performance-audit.md: picks with the projection within 0.35 spreads of the line lost in both periods;
    // this is ARCHR's side with that band left out, tracked forward to see if leaving it out pays.
    key: "distance-035-v1",
    label: "Distance: ARCHR's side · projection 0.35+ beyond the line",
    filters: { ...DEFAULT_FILTERS, archrSide: true, minZ: 0.35 },
  },
  {
    // The same sweep's widest set whose ROI interval cleared zero.
    key: "unders-base-v1",
    label: "Unders base: unders · −200 to +100 · minutes 24+ · ARCHR's side",
    filters: { ...DEFAULT_FILTERS, side: "under", shortest: -200, longest: 100, minMinutes: 24, archrSide: true },
  },
];

const LABELS = new Map(TRACKED_SCREENS.map((s) => [s.key, s.label]));
export const screenLabel = (key: string) => LABELS.get(key) ?? key;

/** The keys of every tracked set this row passes. */
export function screensPassed(row: ScreenerProp): string[] {
  return TRACKED_SCREENS.filter((s) => passes(row, s.filters)).map((s) => s.key);
}
