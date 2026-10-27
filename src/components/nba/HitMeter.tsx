import type { PropHitRateResult } from "@/lib/props/tally";

/** Hit/miss colors (validated for color-vision deficiency; misses also differ in lightness). */
const HIT_BG = "bg-emerald-600 dark:bg-emerald-400";
const MISS_BG = "bg-slate-300 dark:bg-slate-600";

/** Text color for a hit rate — only strong rates on a real sample get color. */
export function rateTone(rate: PropHitRateResult): string {
  if (rate.hitRate === null || rate.sampleSize < 5) return "text-muted-foreground";
  if (rate.hitRate >= 0.7) return "text-emerald-600 dark:text-emerald-400";
  if (rate.hitRate <= 0.3) return "text-red-600 dark:text-red-400";
  return "text-foreground";
}

export function formatRate(rate: PropHitRateResult): string {
  return rate.hitRate === null ? "—" : `${Math.round(rate.hitRate * 100)}%`;
}

/**
 * The last-10 strip: one tick per game, oldest on the left so it reads like a
 * timeline, filled when the chosen side cashed. The fraction beside it carries
 * the same information as text, so the strip is never the only encoding.
 */
export function HitMeter({
  recent,
  rate,
  window = "L10",
  slots = 10,
}: {
  recent: boolean[];
  rate: PropHitRateResult;
  window?: string;
  /** Ticks in the strip — the window's length. */
  slots?: number;
}) {
  const ticks = [...recent].reverse();
  return (
    <div className="flex items-center gap-2" aria-label={`Cashed ${rate.hits} of last ${rate.sampleSize}`}>
      <div className="flex items-end gap-[3px]" aria-hidden>
        {Array.from({ length: slots }, (_, i) => {
          const hit = ticks[i - (slots - ticks.length)];
          return (
            <span
              key={i}
              className={`h-4 w-1.5 rounded-full ${hit === undefined ? "bg-muted" : hit ? HIT_BG : MISS_BG}`}
            />
          );
        })}
      </div>
      <span className={`font-mono text-sm font-semibold ${rateTone(rate)}`}>{formatRate(rate)}</span>
      <span className="text-xs text-muted-foreground">
        {rate.sampleSize === 0 ? "no games" : `${rate.hits}/${rate.sampleSize} ${window}`}
      </span>
    </div>
  );
}
