"use client";

/**
 * The page's one deliberate write control — a button, not a form submitted
 * on load, not an effect that fires on mount. Calls the Server Action
 * directly from an event handler wrapped in `startTransition`, per Next.js's
 * own Server Actions guidance for non-form invocations.
 */
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { recordNflResearchSnapshot, type RecordNflResearchSnapshotResult } from "@/app/nfl/research/actions";

export function RecordSnapshotButton() {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<RecordNflResearchSnapshotResult | null>(null);

  function run(confirmRerun: boolean) {
    startTransition(async () => {
      const r = await recordNflResearchSnapshot(confirmRerun);
      setResult(r);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button onClick={() => run(false)} disabled={isPending}>
          {isPending ? "Recording…" : "Record prediction snapshot"}
        </Button>
        {result?.blockedByExistingRun ? (
          <Button variant="outline" onClick={() => run(true)} disabled={isPending}>
            Record anyway (new revision)
          </Button>
        ) : null}
      </div>

      {result ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          {result.error ? (
            <p className="text-destructive">Failed: {result.error}</p>
          ) : result.blockedByExistingRun ? (
            <p>
              A snapshot already exists for this slate (run {result.blockedByExistingRun.id}, generated{" "}
              {new Date(result.blockedByExistingRun.generatedAt).toLocaleString()}). Click &quot;Record anyway&quot;
              to save a new, additional revision — this never overwrites the earlier one.
            </p>
          ) : result.runId ? (
            <p>
              Recorded run {result.runId}: {result.rowsWritten} prediction row(s) across {result.eligibleGameCount}{" "}
              game(s) ({result.exclusionCount} excluded). This is a frozen, experimental, signal-only snapshot — not
              posted anywhere, not used for any live recommendation.
            </p>
          ) : (
            <p>Nothing eligible right now — no snapshot was written.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
