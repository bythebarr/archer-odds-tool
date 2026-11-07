/**
 * Self-diagnosis, stage 1 (Phase 2 Item C / audit §3): a daily pure read over
 * settled tracking data that turns "the app records results" into "the app
 * notices what's wrong". It computes, per model × stat and overall:
 *
 *   - calibration drift (ARCHR's stated chance vs the hit rate, sample-gated)
 *   - projection bias (realized minus projected, against the frozen spread)
 *   - sample progress toward the 300-graded bar a stat needs to be trusted
 *   - CLV coverage (a feed/ops signal, never dressed up as a model signal)
 *   - pipeline integrity (void rate, leans stuck unsettled)
 *   - feed staleness and credit-guardrail gauge sanity, from PollLog state
 *
 * Every check carries its n and fires only past its sample gate — a flag
 * below the gate would be noise wearing a lab coat. The weekly refit
 * PROPOSAL generator stays a spec on purpose: weights are Sam's decisions.
 * This module is pure; the DB loading/writing lives in queries/diagnosis.
 */
import type { SettleResult } from "./types";

/** Graded props a stat needs before its blend can be called proven (the 300 bar). */
export const SAMPLE_TARGET = 300;

export interface DiagnoseLean {
  sport: string;
  stat: string;
  kind: string;
  prob: number;
  result: SettleResult;
  actual: number | null;
  projMean: number | null;
  projSd: number | null;
  closingProb: number | null;
  startsAt: Date;
}

export interface FeedState {
  job: string;
  status: string;
  /** Hours since the feed last completed (any status), null when it never has. */
  ageHours: number | null;
  staleAfterHours: number;
}

export interface GaugeState {
  creditsRemaining: number | null;
  gaugeAgeHours: number | null;
  blockedJobs: string[];
}

export interface DiagnosisFlag {
  kind: "calibration" | "bias" | "clv-coverage" | "void-rate" | "pending" | "feed" | "guardrail";
  key: string;
  severity: "warn" | "info";
  message: string;
  n: number | null;
}

export interface StatProgress {
  key: string;
  label: string;
  n: number;
  target: number;
  pct: number;
}

const SPORT_LABEL: Record<string, string> = { nba: "NBA", nfl: "NFL" };
const pct1 = (x: number) => `${Math.round(x * 100)}%`;
const pts = (x: number) => `${Math.round(Math.abs(x) * 100)} pts`;

/** Graded (hit/miss) prop counts per sport × stat, against the 300 bar. */
export function sampleProgress(leans: DiagnoseLean[]): StatProgress[] {
  const groups = new Map<string, number>();
  for (const l of leans) {
    if (l.kind !== "prop" || (l.result !== "hit" && l.result !== "miss")) continue;
    const key = `${l.sport}:${l.stat}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([key, n]) => {
      const [sport, stat] = key.split(":");
      return { key, label: `${SPORT_LABEL[sport] ?? sport} ${stat}`, n, target: SAMPLE_TARGET, pct: Math.min(1, n / SAMPLE_TARGET) };
    })
    .sort((a, b) => b.n - a.n);
}

export function diagnose(input: { leans: DiagnoseLean[]; feeds: FeedState[]; gauge: GaugeState; pendingStale: number }): {
  flags: DiagnosisFlag[];
  progress: StatProgress[];
  gradedTotal: number;
} {
  const flags: DiagnosisFlag[] = [];
  const graded = input.leans.filter((l) => l.result === "hit" || l.result === "miss");

  // Per sport × stat prop checks: calibration drift and projection bias.
  const byStat = new Map<string, DiagnoseLean[]>();
  for (const l of graded) {
    if (l.kind !== "prop") continue;
    const key = `${l.sport}:${l.stat}`;
    (byStat.get(key) ?? byStat.set(key, []).get(key)!).push(l);
  }
  for (const [key, list] of byStat) {
    const [sport, stat] = key.split(":");
    const label = `${SPORT_LABEL[sport] ?? sport} ${stat}`;
    if (list.length >= 50) {
      const said = list.reduce((a, l) => a + l.prob, 0) / list.length;
      const hit = list.filter((l) => l.result === "hit").length / list.length;
      const drift = said - hit;
      if (Math.abs(drift) >= 0.08) {
        flags.push({
          kind: "calibration",
          key,
          severity: "warn",
          n: list.length,
          message: `${label}: ARCHR said ${pct1(said)} on average but hit ${pct1(hit)} over ${list.length} graded leans — calibration is off by ${pts(drift)} (${drift > 0 ? "overconfident" : "underconfident"}).`,
        });
      }
    }
    const withProj = list.filter((l) => l.projMean !== null && l.actual !== null);
    if (withProj.length >= 100) {
      const bias = withProj.reduce((a, l) => a + (l.actual! - l.projMean!), 0) / withProj.length;
      const sds = withProj.filter((l) => l.projSd !== null && l.projSd > 0);
      const sdRef = sds.length ? sds.reduce((a, l) => a + l.projSd!, 0) / sds.length : null;
      if (sdRef !== null && Math.abs(bias) > 0.35 * sdRef) {
        flags.push({
          kind: "bias",
          key,
          severity: "warn",
          n: withProj.length,
          message: `${label}: projections run ${Math.abs(bias).toFixed(1)} ${stat} ${bias > 0 ? "low — players beat the projection" : "high — players fall short of the projection"} on average over ${withProj.length} graded leans (bias beyond a third of the projection spread).`,
        });
      }
    }
  }

  // CLV coverage: a feed problem when thin, never a model verdict.
  if (graded.length >= 50) {
    const withClose = graded.filter((l) => l.closingProb !== null).length;
    const coverage = withClose / graded.length;
    if (coverage < 0.5) {
      flags.push({
        kind: "clv-coverage",
        key: "all",
        severity: "warn",
        n: graded.length,
        message: `Closing-line value is captured on only ${pct1(coverage)} of ${graded.length} graded leans — too thin to judge edges by CLV. That is a feed problem, not a model signal.`,
      });
    }
  }

  // Pipeline integrity: voids and stuck settlements.
  const settledTotal = input.leans.length;
  if (settledTotal >= 50) {
    const voids = input.leans.filter((l) => l.result === "void").length;
    if (voids / settledTotal > 0.15) {
      flags.push({
        kind: "void-rate",
        key: "all",
        severity: "warn",
        n: settledTotal,
        message: `${pct1(voids / settledTotal)} of settled leans are voids (${voids} of ${settledTotal}) — above the 15% line where pipeline breakage starts hiding inside DNPs.`,
      });
    }
  }
  if (input.pendingStale > 0) {
    flags.push({
      kind: "pending",
      key: "all",
      severity: "warn",
      n: input.pendingStale,
      message: `${input.pendingStale} captured ${input.pendingStale === 1 ? "lean is" : "leans are"} still unsettled more than 24h after the start — the results sync or settlement needs a look.`,
    });
  }

  // Feeds: errored or silent past their threshold. A guardrail-blocked stamp
  // is the guardrail flag's story, not staleness.
  for (const feed of input.feeds) {
    if (feed.status.startsWith("error")) {
      flags.push({ kind: "feed", key: feed.job, severity: "warn", n: null, message: `Feed ${feed.job} last ran with an error: ${feed.status.slice(0, 120)}` });
    } else if (!feed.status.includes("blocked") && (feed.ageHours === null || feed.ageHours > feed.staleAfterHours)) {
      flags.push({
        kind: "feed",
        key: feed.job,
        severity: "warn",
        n: null,
        message: feed.ageHours === null ? `Feed ${feed.job} has never completed a run.` : `Feed ${feed.job} has not completed in ${Math.round(feed.ageHours)}h (threshold ${feed.staleAfterHours}h) — boards fed by it are stale.`,
      });
    }
  }

  // Guardrail gauge sanity.
  if (input.gauge.blockedJobs.length) {
    flags.push({
      kind: "guardrail",
      key: "credits",
      severity: "warn",
      n: null,
      message: `The credit guardrail is blocking ${input.gauge.blockedJobs.join(", ")} — keyed polls are paused by design until credits recover or the provider tier is funded.`,
    });
  }
  if (input.gauge.creditsRemaining === null) {
    flags.push({
      kind: "guardrail",
      key: "credits",
      severity: "info",
      n: null,
      message: "No credit-gauge reading on file — the guardrail has no balance to judge against until the next keyed poll or recovery probe lands one.",
    });
  } else if (input.gauge.gaugeAgeHours !== null && input.gauge.gaugeAgeHours > 48) {
    flags.push({
      kind: "guardrail",
      key: "credits",
      severity: "info",
      n: null,
      message: `The credit gauge (last reading ${input.gauge.creditsRemaining}) is ${Math.round(input.gauge.gaugeAgeHours)}h old — treat it as approximate until a keyed poll refreshes it.`,
    });
  }

  return { flags, progress: sampleProgress(input.leans), gradedTotal: graded.length };
}
