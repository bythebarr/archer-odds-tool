/**
 * Turns a projected mean into P(stat > line) using the empirical distribution of
 * actual/projected ratios observed on the training window, bucketed by
 * projection size (a 30-yard projection and a 90-yard projection have very
 * different shapes — the small one is zero-heavy). Calibrated by construction on
 * train; honest out of sample only to the extent the ratio shape is stable,
 * which the validation calibration table checks.
 */
const PROB_FLOOR = 0.02;
const PROB_CEILING = 0.98;

interface Bin {
  maxMu: number;
  ratios: Float64Array; // sorted ascending
}

/** Serializable form: each bin's ratio distribution reduced to evenly spaced quantiles. */
export interface FrozenRatioDistribution {
  bins: { maxMu: number | null; q: number[] }[];
}

export class RatioDistribution {
  private constructor(private readonly bins: Bin[]) {}

  static fromFrozen(f: FrozenRatioDistribution): RatioDistribution {
    return new RatioDistribution(f.bins.map((b) => ({ maxMu: b.maxMu ?? Infinity, ratios: Float64Array.from(b.q) })));
  }

  toFrozen(quantiles = 201): FrozenRatioDistribution {
    return {
      bins: this.bins.map((b) => ({
        maxMu: Number.isFinite(b.maxMu) ? b.maxMu : null,
        q: Array.from({ length: quantiles }, (_, i) => {
          const pos = (i / (quantiles - 1)) * (b.ratios.length - 1);
          const lo = Math.floor(pos);
          const hi = Math.min(b.ratios.length - 1, lo + 1);
          return +(b.ratios[lo] + (b.ratios[hi] - b.ratios[lo]) * (pos - lo)).toFixed(5);
        }),
      })),
    };
  }

  /** Fit from (projection, actual) pairs; projections ≤ 0 are ignored. */
  static fit(pairs: readonly { mu: number; y: number }[], binCount = 10): RatioDistribution {
    const usable = pairs.filter((p) => p.mu > 0).sort((a, b) => a.mu - b.mu);
    if (usable.length === 0) throw new Error("RatioDistribution.fit: no usable pairs");
    const per = Math.ceil(usable.length / binCount);
    const bins: Bin[] = [];
    for (let i = 0; i < usable.length; i += per) {
      const chunk = usable.slice(i, i + per);
      bins.push({
        maxMu: chunk[chunk.length - 1].mu,
        ratios: Float64Array.from(chunk.map((p) => p.y / p.mu)).sort(),
      });
    }
    bins[bins.length - 1].maxMu = Infinity;
    return new RatioDistribution(bins);
  }

  /** P(actual > line) for a projection `mu`. */
  pOver(mu: number, line: number): number {
    if (mu <= 0) return PROB_FLOOR;
    const bin = this.bins.find((b) => mu <= b.maxMu)!;
    const threshold = line / mu;
    // count ratios strictly above threshold via binary search on the sorted array
    let lo = 0;
    let hi = bin.ratios.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (bin.ratios[mid] <= threshold) lo = mid + 1;
      else hi = mid;
    }
    const above = bin.ratios.length - lo;
    const p = (above + 0.5) / (bin.ratios.length + 1);
    return Math.min(PROB_CEILING, Math.max(PROB_FLOOR, p));
  }
}

/**
 * Logistic recalibration p' = σ(a + b·logit(p)), fit on train by Newton's
 * method. The ratio distribution is calibrated marginally, but where the
 * projection disagrees sharply with a realistic line its tails run
 * overconfident (0.93 → 0.84 observed in validation before this step, the
 * same shape on train) — model error and disagreement are correlated, which
 * a per-bin ratio shape can't see. b < 1 pulls the tails in.
 */
export class LogisticCalibrator {
  constructor(readonly a: number, readonly b: number) {}

  static fit(pairs: readonly { p: number; y: 0 | 1 }[], iterations = 25): LogisticCalibrator {
    let a = 0;
    let b = 1;
    const xs = pairs.map((q) => logit(q.p));
    for (let it = 0; it < iterations; it++) {
      let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
      pairs.forEach((q, i) => {
        const x = xs[i];
        const p = 1 / (1 + Math.exp(-(a + b * x)));
        const r = q.y - p;
        const w = p * (1 - p);
        ga += r;
        gb += r * x;
        haa += w;
        hab += w * x;
        hbb += w * x * x;
      });
      const det = haa * hbb - hab * hab;
      if (det <= 0) break;
      a += (hbb * ga - hab * gb) / det;
      b += (haa * gb - hab * ga) / det;
    }
    return new LogisticCalibrator(a, b);
  }

  apply(p: number): number {
    const q = 1 / (1 + Math.exp(-(this.a + this.b * logit(p))));
    return Math.min(PROB_CEILING, Math.max(PROB_FLOOR, q));
  }
}

function logit(p: number): number {
  const c = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return Math.log(c / (1 - c));
}
