/**
 * Thin orchestration layer for CFB forward-prediction capture (see
 * docs/architecture/MODEL-PREDICTION-LIFECYCLE.md). Fetches the free ESPN
 * slate/history and delegates everything else to the pure builder
 * (`predictionCapture.ts`) and the generic storage layer
 * (`src/lib/predictions`). No business logic lives here — this module is
 * intentionally as small as it can be. `scripts/capture-cfb-predictions.ts`
 * is the only caller today.
 */
import { prisma } from "@/lib/prisma";
import { etDayBoundsUtc } from "@/lib/dateEt";
import { fetchCfbDateSlate, fetchCfbSeasonThrough } from "./espnScoreboard";
import { buildTeamRatings } from "./ratings";
import { buildCfbPredictionRun, CFB_SPORT_KEY, type CfbCaptureResult } from "./predictionCapture";
import { CFB_MODEL_KEY, CFB_MODEL_VERSION } from "./modelIdentity";
import { createPredictionRun, type CreatedPredictionRun } from "@/lib/predictions";

/**
 * Bowl-season games in January belong to the prior fall's season. Duplicated
 * (not imported) from `src/app/cfb/page.tsx`'s private helper of the same
 * name and behavior — deliberately: this task's constraints rule out UI
 * changes, and extracting a shared module for four lines would mean editing
 * page.tsx's imports to use it. If a third caller ever needs this, that's
 * the point to extract it for real.
 */
export function seasonForDate(dateEt: string): number {
  const year = Number(dateEt.slice(0, 4));
  const month = Number(dateEt.slice(5, 7));
  return month === 1 ? year - 1 : year;
}

export interface ExistingCfbRun {
  id: string;
  generatedAt: Date;
}

export interface CaptureCfbPredictionsResult {
  capture: CfbCaptureResult;
  /** Null when nothing was eligible, or when blocked by an existing run — nothing was written to the database. */
  written: CreatedPredictionRun | null;
  /** Set only when a same-day run for this exact model/version already exists and `confirmRerun` wasn't passed — see this module's docstring on why this is a soft, confirmable gate rather than a hard schema constraint. */
  blockedByExistingRun: ExistingCfbRun | null;
}

/**
 * **Retry-protection decision (see the task that produced this module for
 * the full reasoning).** There is no DB-level idempotency key on
 * `PredictionRun` for CFB captures, and this module does not add one. A
 * clean key would need a time "bucket" (e.g. per-minute, per-hour) to tell
 * "an accidental double-invocation" apart from "a deliberate later-in-the-day
 * recapture with updated ratings" — and any bucket size is an arbitrary line
 * with no principled way to justify it, which would make a genuine same-day
 * revision either silently blocked (too coarse) or unprotected against a
 * real retry a few minutes later (too fine). Faking a specific bucket size
 * would be worse than not having one.
 *
 * Instead: before capturing, this function checks whether a `PredictionRun`
 * already exists for the SAME (sportKey, modelKey, modelVersion) within the
 * target ET calendar day. If one does, and `confirmRerun` is not `true`, it
 * returns `blockedByExistingRun` instead of fetching/writing anything — the
 * caller (the CLI script) surfaces this and requires an explicit
 * `--confirm-rerun` flag to proceed. This is a soft, human-in-the-loop gate,
 * not an enforced constraint: nothing about `createPredictionRun`'s own
 * ability to store a legitimate revision is weakened or restricted by this
 * check — a confirmed rerun writes a normal, additional, fully valid run.
 *
 * The decision itself is isolated as a pure predicate below so it's
 * unit-testable without a database (see `capturePredictions.test.ts`).
 *
 * **Honest scope of this protection (adversarial review, added after the
 * first implementation).** `findExistingRunForDate` below queries the real,
 * shared database — not an in-memory cache — so it correctly detects a run
 * committed by an EARLIER, already-finished process (including one on a
 * different machine, or one that finished after a timeout the caller gave
 * up waiting on). What it does NOT do: protect against two invocations that
 * are BOTH mid-flight at the same time. The check-then-write here is not
 * atomic — two processes started at nearly the same instant could both read
 * "no existing run" before either has written one, and both then proceed to
 * write a full duplicate run. This is a real, accepted gap, not silently
 * assumed away: given this is a manual, single-operator CLI (never a cron,
 * never run from multiple workers), the realistic likelihood is low, and
 * closing it would require exactly the arbitrary time-bucket tradeoff this
 * docstring already rejected above. Do not describe this mechanism as
 * "cross-process safe" in the stronger, race-free sense — it is only
 * "detects an already-completed prior run," which is what it actually does.
 */
export function shouldBlockRerun(existing: ExistingCfbRun | null, confirmRerun: boolean): boolean {
  return existing !== null && !confirmRerun;
}

/**
 * Looks for a prior run that already produced a prediction for a game
 * kicking off within `dateEt`'s ET day — NOT for a run GENERATED on that
 * day. Those are different things: `dateEt` is the date of the SLATE being
 * predicted (almost always a future date relative to when the script runs),
 * while `generatedAt` is always "now." Querying `generatedAt` against
 * `dateEt`'s day-bounds would only ever match the degenerate case of
 * capturing today's own slate today — for the realistic case (capturing a
 * future Saturday's slate this week), it would never find the earlier run,
 * silently defeating the whole guard. Querying by `ModelPrediction.
 * scheduledStartUtc` (indexed, and always the actual game date regardless
 * of when the capture ran) is what makes "have we already captured THIS
 * slate" correct.
 *
 * One consequence worth naming: if ESPN moves a game's kickoff across a
 * calendar-day boundary between two captures (a real occurrence — TV
 * scheduling), this check's notion of "which date's slate a game belongs
 * to" moves with it. A prior capture of the game under its OLD date won't
 * be found when re-capturing under the corrected date — that's a NEW,
 * additional revision under the new date bucket, not a bug: it matches what
 * a human would expect ("this is now Saturday's game, not Friday's").
 */
async function findExistingRunForDate(dateEt: string): Promise<ExistingCfbRun | null> {
  const { gte, lt } = etDayBoundsUtc(dateEt);
  const existing = await prisma.modelPrediction.findFirst({
    where: {
      scheduledStartUtc: { gte, lt },
      run: { sportKey: CFB_SPORT_KEY, modelKey: CFB_MODEL_KEY, modelVersion: CFB_MODEL_VERSION },
    },
    orderBy: { run: { generatedAt: "desc" } },
    select: { run: { select: { id: true, generatedAt: true } } },
  });
  return existing ? existing.run : null;
}

/**
 * Captures one CFB forward-prediction run for `dateEt`. `now` is the single
 * instant used as BOTH `generatedAt` and `dataAsOfUtc` (see
 * `buildCfbPredictionRun`'s docstring for why using one value for both is
 * the simplest legitimate choice) and as the cutoff passed to every ESPN
 * fetch and to `buildTeamRatings` — captured once, by the caller, so every
 * timestamp this run touches is provably the same moment. Defaults to
 * `new Date()` for real use; tests pass a fixed value.
 */
export async function captureCfbPredictions(
  dateEt: string,
  opts: { now?: Date; confirmRerun?: boolean } = {}
): Promise<CaptureCfbPredictionsResult> {
  const now = opts.now ?? new Date();

  const existing = await findExistingRunForDate(dateEt);
  if (shouldBlockRerun(existing, opts.confirmRerun ?? false)) {
    return {
      capture: { runInput: null, eligibleGameCount: 0, exclusions: [] },
      written: null,
      blockedByExistingRun: existing,
    };
  }

  const season = seasonForDate(dateEt);
  const [slate, seasonGames] = await Promise.all([fetchCfbDateSlate(dateEt), fetchCfbSeasonThrough(season, now)]);

  const ratingBook = buildTeamRatings(seasonGames, now);
  const capture = buildCfbPredictionRun({
    slate,
    ratingBook,
    generatedAt: now,
    dataAsOfUtc: now,
    dateEt,
  });

  if (!capture.runInput) {
    return { capture, written: null, blockedByExistingRun: null };
  }

  const written = await createPredictionRun(capture.runInput);
  return { capture, written, blockedByExistingRun: null };
}
