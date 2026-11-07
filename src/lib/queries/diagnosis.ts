/**
 * The diagnose job's data layer (Phase 2 C): loads what lib/tracking/diagnose
 * reads (settled leans with their effective grades, feed states, the credit
 * gauge), persists each daily run's flags to DiagnosisFlag rows, and serves
 * the latest run to the owner-only /models/edges page. Zero paid calls —
 * everything here reads rows the polls and tracker already wrote.
 */
import { unstable_cache } from "next/cache";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getLatestCreditsRemaining } from "@/lib/pollingPolicy";
import { KNOWN_LEAN_SCHEMAS, TRACKED_MODELS, type LeanFeatures, type SettleResult } from "@/lib/tracking/types";
import { applyCorrections } from "@/lib/tracking/corrections";
import { diagnose, type DiagnoseLean, type FeedState, type GaugeState } from "@/lib/tracking/diagnose";

/** Feeds the diagnosis watches, with the silence each is allowed (hours). */
const WATCHED_FEEDS: { job: string; staleAfterHours: number }[] = [
  { job: "espn-odds", staleAfterHours: 4 },
  { job: "poll-all-sports", staleAfterHours: 4 },
  { job: "capture-leans", staleAfterHours: 4 },
  { job: "settle-leans", staleAfterHours: 8 },
  { job: "poll-odds-nba", staleAfterHours: 26 },
  { job: "poll-odds-nfl", staleAfterHours: 26 },
];

const WINDOW_DAYS = 90;

export async function loadDiagnosisInputs(now = new Date()): Promise<{ leans: DiagnoseLean[]; feeds: FeedState[]; gauge: GaugeState; pendingStale: number }> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const rows = await prisma.predictionSettlement.findMany({
    where: { prediction: { scheduledStartUtc: { gte: since }, run: { modelKey: { in: Object.values(TRACKED_MODELS) } } } },
    select: {
      predictionId: true,
      result: true,
      actual: true,
      closingProb: true,
      closingPrice: true,
      prediction: { select: { probability: true, featureSnapshot: true, scheduledStartUtc: true, run: { select: { featureSchemaVersion: true } } } },
    },
  });
  const corrections = rows.length
    ? await prisma.settlementCorrection.findMany({ where: { predictionId: { in: rows.map((r) => r.predictionId) } }, orderBy: { createdAt: "asc" } })
    : [];
  const effective = new Map(
    applyCorrections(
      rows.map((r) => ({ predictionId: r.predictionId, result: r.result as SettleResult, actual: r.actual, closingProb: r.closingProb, closingPrice: r.closingPrice })),
      corrections.map((c) => ({ predictionId: c.predictionId, result: c.result as SettleResult, actual: c.actual, closingProb: c.closingProb, closingPrice: c.closingPrice, createdAt: c.createdAt })),
    ).map((e) => [e.predictionId, e]),
  );
  const leans: DiagnoseLean[] = rows.flatMap((r) => {
    if (r.prediction.probability === null || !KNOWN_LEAN_SCHEMAS.includes(r.prediction.run.featureSchemaVersion)) return [];
    const f = r.prediction.featureSnapshot as unknown as LeanFeatures;
    const eff = effective.get(r.predictionId)!;
    return [
      {
        sport: f.sport,
        stat: f.stat,
        kind: f.kind,
        prob: r.prediction.probability,
        result: eff.result,
        actual: eff.actual,
        projMean: f.projMean ?? null,
        projSd: f.projSd ?? null,
        closingProb: eff.closingProb,
        startsAt: r.prediction.scheduledStartUtc,
      },
    ];
  });

  const pendingStale = await prisma.modelPrediction.count({
    where: { settlement: null, scheduledStartUtc: { lt: new Date(now.getTime() - 24 * 3_600_000) }, run: { modelKey: { in: Object.values(TRACKED_MODELS) } } },
  });

  const logs = await prisma.pollLog.findMany();
  const byJob = new Map(logs.map((l) => [l.jobName, l]));
  const feeds: FeedState[] = WATCHED_FEEDS.map(({ job, staleAfterHours }) => {
    // Tick-run jobs stamp as "tick:<path>"; a direct run stamps the bare name.
    const log = byJob.get(`tick:${job}`) ?? byJob.get(job);
    return {
      job,
      status: log?.lastStatus ?? "",
      ageHours: log ? (now.getTime() - log.lastPolledAt.getTime()) / 3_600_000 : null,
      staleAfterHours,
    };
  });
  const gaugeRows = logs.filter((l) => l.creditsRemaining !== null);
  const gauge: GaugeState = {
    creditsRemaining: await getLatestCreditsRemaining(),
    gaugeAgeHours: gaugeRows.length ? (now.getTime() - Math.max(...gaugeRows.map((l) => l.lastPolledAt.getTime()))) / 3_600_000 : null,
    blockedJobs: logs.filter((l) => l.lastStatus.includes("blocked")).map((l) => l.jobName.replace(/^tick:/, "")),
  };
  return { leans, feeds, gauge, pendingStale };
}

/** Run the diagnosis once and persist the run (flags + one summary row). */
export async function runDiagnosis(now = new Date()): Promise<{ runId: string; flags: number; gradedTotal: number }> {
  const inputs = await loadDiagnosisInputs(now);
  const out = diagnose(inputs);
  const runId = randomUUID();
  await prisma.diagnosisFlag.createMany({
    data: [
      ...out.flags.map((f) => ({ runId, kind: f.kind, flagKey: f.key, severity: f.severity, message: f.message, n: f.n })),
      { runId, kind: "summary", flagKey: null, severity: null, message: null, n: out.gradedTotal, data: JSON.parse(JSON.stringify({ progress: out.progress, gradedTotal: out.gradedTotal })) },
    ],
  });
  return { runId, flags: out.flags.length, gradedTotal: out.gradedTotal };
}

export interface LatestDiagnosis {
  ranAt: string;
  flags: { kind: string; severity: string | null; message: string | null; n: number | null }[];
  progress: { key: string; label: string; n: number; target: number; pct: number }[];
  gradedTotal: number;
}

/** The newest diagnosis run, for the /models/edges Flags strip. */
export const getLatestDiagnosis = unstable_cache(
  async (): Promise<LatestDiagnosis | null> => {
    const latest = await prisma.diagnosisFlag.findFirst({ orderBy: { createdAt: "desc" }, select: { runId: true, createdAt: true } });
    if (!latest) return null;
    const rows = await prisma.diagnosisFlag.findMany({ where: { runId: latest.runId }, orderBy: { createdAt: "asc" } });
    const summary = rows.find((r) => r.kind === "summary");
    const data = (summary?.data ?? {}) as { progress?: LatestDiagnosis["progress"]; gradedTotal?: number };
    return {
      ranAt: latest.createdAt.toISOString(),
      flags: rows.filter((r) => r.kind !== "summary").map((r) => ({ kind: r.kind, severity: r.severity, message: r.message, n: r.n })),
      progress: data.progress ?? [],
      gradedTotal: data.gradedTotal ?? summary?.n ?? 0,
    };
  },
  ["lean-diagnosis"],
  { revalidate: 1800 },
);
