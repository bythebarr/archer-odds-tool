/**
 * The filter sweep (scripts/sweep-filters.ts): which combination of the props
 * screener's own filters picks the props that actually cash and pay, with the
 * −200 price floor always on. Every combination is run through the screener's
 * `passes` (lib/screener/types), so a row here is exactly what the screener
 * would show with those filters set. Measures; changes nothing. Pure.
 *
 * Accuracy is read three ways per combination: hit rate (how often the picks
 * cash), flat-stake ROI at the price (whether they pay — a hit rate means little
 * on its own when the price is −200), and the picks left per slate day. With
 * thousands of combinations some look good by luck, so the pick is made
 * walk-forward: the best combination on the EARLIER half of the dates, judged
 * on the LATER half it never saw.
 */
import { DEFAULT_FILTERS, passes, type ScreenFilters, type ScreenWindow, type ScreenerProp } from "@/lib/screener/types";

/** The price floor on every combination: nothing shorter than −200. */
export const PRICE_FLOOR = -200;

export interface SweepRow {
  prop: ScreenerProp;
  won: 0 | 1;
  /** ET date of the game, for the halves and picks-per-day. */
  date: string;
}

const payout = (american: number) => (american > 0 ? american / 100 : 100 / -american);

export interface PickStats {
  n: number;
  /** Share of picks that cashed; null with none. */
  hitRate: number | null;
  /** Flat-stake ROI at the price; null with none. */
  roi: number | null;
  /** 95% interval on the ROI (normal approximation over per-pick returns). */
  lo: number | null;
  hi: number | null;
}

export function pickStats(rows: SweepRow[]): PickStats {
  const priced = rows.filter((r) => r.prop.priceAmerican !== null);
  if (!priced.length) return { n: 0, hitRate: null, roi: null, lo: null, hi: null };
  const rets = priced.map((r) => (r.won ? payout(r.prop.priceAmerican!) : -1));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / (rets.length - 1)) : 0;
  const se = sd / Math.sqrt(rets.length);
  return { n: priced.length, hitRate: priced.filter((r) => r.won).length / priced.length, roi: mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se };
}

/** The date splitting the rows' days in two (the earlier half takes the middle day). */
export function splitDate(rows: { date: string }[]): string {
  const days = [...new Set(rows.map((r) => r.date))].sort();
  return days[Math.ceil(days.length / 2) - 1] ?? "";
}

/** A record bar the screener can set: per-window minimums and/or the all-windows bar. */
export interface RecordBar {
  label: string;
  min: Partial<Record<ScreenWindow, number>>;
  all: number;
}

export const RECORD_BARS: RecordBar[] = [
  { label: "no record bar", min: {}, all: 0 },
  { label: "L5 ≥ 80%", min: { l5: 0.8 }, all: 0 },
  { label: "L10 ≥ 60%", min: { l10: 0.6 }, all: 0 },
  { label: "L10 ≥ 70%", min: { l10: 0.7 }, all: 0 },
  { label: "L10 ≥ 80%", min: { l10: 0.8 }, all: 0 },
  { label: "L15 ≥ 60%", min: { l15: 0.6 }, all: 0 },
  { label: "L15 ≥ 70%", min: { l15: 0.7 }, all: 0 },
  { label: "szn ≥ 60%", min: { szn: 0.6 }, all: 0 },
  { label: "szn ≥ 70%", min: { szn: 0.7 }, all: 0 },
  { label: "last szn ≥ 60%", min: { last: 0.6 }, all: 0 },
  { label: "L10 ≥ 60% + szn ≥ 60%", min: { l10: 0.6, szn: 0.6 }, all: 0 },
  { label: "L10 ≥ 70% + szn ≥ 60%", min: { l10: 0.7, szn: 0.6 }, all: 0 },
  { label: "every window ≥ 60%", min: {}, all: 0.6 },
];

export const MIN_ARCHR = [0, 0.55, 0.6, 0.65, 0.7];
export const MIN_EDGE: (number | null)[] = [null, 0, 0.03, 0.05, 0.08];
export const SIDES: ScreenFilters["side"][] = [null, "over", "under"];
/** The long end of the price range (the floor stays −200); null = open. */
export const LONGEST: (number | null)[] = [null, 150, 100];
/** NBA only: projected minutes at least this. */
export const MIN_MINUTES = [0, 24, 30];

export interface Combo {
  label: string;
  filters: ScreenFilters;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Every combination on the grid, each as the screener's own filter object with the −200 floor on. */
export function comboGrid(opts: { minutes: boolean }): Combo[] {
  const out: Combo[] = [];
  for (const bar of RECORD_BARS)
    for (const minArchr of MIN_ARCHR)
      for (const minEdge of MIN_EDGE)
        for (const side of SIDES)
          for (const longest of LONGEST)
            for (const minMinutes of opts.minutes ? MIN_MINUTES : [0]) {
              const parts = [
                bar.label,
                minArchr ? `ARCHR ≥ ${pct(minArchr)}` : null,
                minEdge !== null ? `edge ≥ ${Math.round(minEdge * 100)} pts` : null,
                side ? `${side}s only` : null,
                `price −200 to ${longest === null ? "any" : `+${longest}`}`,
                minMinutes ? `minutes ≥ ${minMinutes}` : null,
              ].filter(Boolean);
              out.push({
                label: parts.join(" · "),
                filters: { ...DEFAULT_FILTERS, sort: "l10", min: bar.min, all: bar.all, minArchr, minEdge, side, shortest: PRICE_FLOOR, longest, minMinutes },
              });
            }
  return out;
}

export interface ComboResult {
  combo: Combo;
  all: PickStats;
  early: PickStats;
  late: PickStats;
  /** Picks per slate day the sample covers. */
  perDay: number;
}

export function evaluate(rows: SweepRow[], combos: Combo[]): ComboResult[] {
  const cut = splitDate(rows);
  const days = new Set(rows.map((r) => r.date)).size || 1;
  return combos.map((combo) => {
    const kept = rows.filter((r) => passes(r.prop, combo.filters));
    return {
      combo,
      all: pickStats(kept),
      early: pickStats(kept.filter((r) => r.date <= cut)),
      late: pickStats(kept.filter((r) => r.date > cut)),
      perDay: kept.length / days,
    };
  });
}

/** A combination needs this many picks in a half to be judged on it. */
export const MIN_HALF_PICKS = 50;

/** Positive ROI in both halves, each on MIN_HALF_PICKS+ picks: the combinations that held up. */
export function stable(results: ComboResult[]): ComboResult[] {
  return results
    .filter((r) => r.early.n >= MIN_HALF_PICKS && r.late.n >= MIN_HALF_PICKS && (r.early.roi ?? -1) > 0 && (r.late.roi ?? -1) > 0)
    .sort((a, b) => (b.all.roi ?? -1) - (a.all.roi ?? -1));
}

export interface WalkForward {
  /** The best combinations by earlier-half ROI (MIN_HALF_PICKS+ picks there), best first. */
  picked: ComboResult[];
  /** Of those, how many kept a positive ROI on the later half. */
  heldUp: number;
}

/** Choose on the earlier half only, then read the later half it never saw. */
export function walkForward(results: ComboResult[], top = 10): WalkForward {
  const picked = results
    .filter((r) => r.early.n >= MIN_HALF_PICKS && r.late.n > 0)
    .sort((a, b) => (b.early.roi ?? -1) - (a.early.roi ?? -1))
    .slice(0, top);
  return { picked, heldUp: picked.filter((r) => (r.late.roi ?? -1) > 0).length };
}
