"use server";

/**
 * The NFL research page's ONE deliberate write path (see docs/architecture/
 * NFL-RESEARCH.md). A Server Action is an unauthenticated POST endpoint
 * reachable to anyone who can send the request (see Next.js's own Server
 * Actions security guidance) — this action takes no untrusted payload beyond
 * a single boolean flag and re-derives everything else itself, server-side,
 * from the free ESPN/nflverse sources and the current instant; it never
 * accepts client-supplied prediction data to write.
 *
 * No cron, no automatic polling — this only ever runs when a person clicks
 * the button on `/nfl/research`.
 */
import { captureNflResearchSnapshot } from "@/lib/nfl/research/captureSnapshot";

export interface RecordNflResearchSnapshotResult {
  eligibleGameCount: number;
  exclusionCount: number;
  runId: string | null;
  rowsWritten: number;
  blockedByExistingRun: { id: string; generatedAt: string } | null;
  error: string | null;
}

export async function recordNflResearchSnapshot(confirmRerun: boolean): Promise<RecordNflResearchSnapshotResult> {
  try {
    const result = await captureNflResearchSnapshot({ confirmRerun });
    return {
      eligibleGameCount: result.slate.eligible.length,
      exclusionCount: result.slate.exclusions.length,
      runId: result.written?.runId ?? null,
      rowsWritten: result.written?.predictionIds.length ?? 0,
      blockedByExistingRun: result.blockedByExistingRun
        ? { id: result.blockedByExistingRun.id, generatedAt: result.blockedByExistingRun.generatedAt.toISOString() }
        : null,
      error: null,
    };
  } catch (err) {
    // Action returns are serialized to the client — never forward a raw
    // error object/stack, just a short, secret-free message.
    const message = err instanceof Error ? err.message : String(err);
    return {
      eligibleGameCount: 0,
      exclusionCount: 0,
      runId: null,
      rowsWritten: 0,
      blockedByExistingRun: null,
      error: message,
    };
  }
}
