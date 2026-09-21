/**
 * Thin orchestration for the NFL research "record prediction snapshot"
 * action (see docs/architecture/NFL-RESEARCH.md). Fetches the free ESPN
 * schedule and free nflverse history, builds the Elo-as-of book, builds the
 * slate/run via the pure functions in `predictionCapture.ts`, and — unless
 * blocked by the retry guard below — calls `createPredictionRun`. Called
 * only from a deliberate, user-triggered Server Action
 * (`src/app/nfl/research/actions.ts`); nothing here runs on a schedule.
 */
import { prisma } from "@/lib/prisma";
import { fetchNflGames } from "../games";
import { fetchCurrentNflSchedule } from "./espnSchedule";
import { buildNflEloAsOf } from "./eloAsOf";
import { buildNflResearchSlate, buildNflResearchPredictionRun, type NflResearchSlate } from "./predictionCapture";
import { NFL_RESEARCH_SPORT_KEY, NFL_RESEARCH_MODEL_KEY, NFL_RESEARCH_MODEL_VERSION } from "./modelIdentity";
import { createPredictionRun, type CreatedPredictionRun } from "@/lib/predictions";

export interface ExistingNflResearchRun {
  id: string;
  generatedAt: Date;
}

/**
 * The retry/idempotency decision — a pure predicate, deliberately duplicated
 * (not imported) from `src/lib/cfb/capturePredictions.ts`'s identical
 * `shouldBlockRerun`, the same way CFB's own `seasonForDate` is duplicated
 * from `page.tsx` rather than cross-imported between two otherwise-unrelated
 * sport modules — see that file's docstring for the full reasoning this
 * mirrors: no DB-level idempotency key exists (any time/window bucket would
 * be an arbitrary line against a legitimate later-in-the-week recapture), so
 * this is a soft, human-confirmed gate. Same honest scope note applies:
 * this check queries the real database and correctly catches a retry after
 * an earlier, already-finished process, but the check-then-write is not
 * atomic — two truly concurrent invocations could both pass it. Accepted,
 * not fixed, for the same reason CFB accepted it: a manual, single-operator
 * trigger (here, a button click), never a cron or multi-worker job.
 */
export function shouldBlockRerun(existing: ExistingNflResearchRun | null, confirmRerun: boolean): boolean {
  return existing !== null && !confirmRerun;
}

/**
 * Unlike CFB's date-bucketed check (a caller-supplied ET date), NFL research
 * has no single caller-supplied date — a "slate" is whatever's currently
 * eligible on ESPN's current-week response. So the identity check is scoped
 * to the EXACT set of `eventRef`s (ESPN event ids) in the current eligible
 * slate, not a date-range window.
 *
 * A date-range window (an earlier version of this function used
 * `scheduledStartUtc BETWEEN min AND max` across the slate) was found, by
 * adversarial review, to be over-broad: around a bye week or an
 * internationally-scheduled game, one week's eligible kickoffs can span
 * further than the usual Thursday–Monday window, enough to overlap an
 * ADJACENT week's already-recorded games even though none of those specific
 * games are in the current slate — a false "blocked" for a genuinely new,
 * non-duplicate slate. Matching on the exact `eventRef` set removes that
 * possibility entirely: a prior run only blocks a new one if it actually
 * recorded a prediction for one of THIS slate's specific games.
 */
async function findExistingRunForEvents(eventRefs: readonly string[]): Promise<ExistingNflResearchRun | null> {
  const existing = await prisma.modelPrediction.findFirst({
    where: {
      eventRef: { in: [...eventRefs] },
      run: { sportKey: NFL_RESEARCH_SPORT_KEY, modelKey: NFL_RESEARCH_MODEL_KEY, modelVersion: NFL_RESEARCH_MODEL_VERSION },
    },
    orderBy: { run: { generatedAt: "desc" } },
    select: { run: { select: { id: true, generatedAt: true } } },
  });
  return existing ? existing.run : null;
}

export interface CaptureNflResearchSnapshotResult {
  slate: NflResearchSlate;
  /** Null when nothing was eligible, or when blocked by an existing run. */
  written: CreatedPredictionRun | null;
  blockedByExistingRun: ExistingNflResearchRun | null;
}

/**
 * Fetches, builds, and (unless blocked or nothing eligible) writes one NFL
 * research prediction run. `now` is captured once and used as BOTH
 * `generatedAt` and `dataAsOfUtc` and as the Elo replay's own cutoff — same
 * single-instant discipline as CFB's `capturePredictions.ts`.
 */
export async function captureNflResearchSnapshot(
  opts: { now?: Date; confirmRerun?: boolean } = {}
): Promise<CaptureNflResearchSnapshotResult> {
  const now = opts.now ?? new Date();

  const [schedule, nflverseGames] = await Promise.all([fetchCurrentNflSchedule(), fetchNflGames()]);
  const eloBook = buildNflEloAsOf(nflverseGames, now);
  const slate = buildNflResearchSlate({ schedule, eloBook, generatedAt: now });

  if (slate.eligible.length === 0) {
    return { slate, written: null, blockedByExistingRun: null };
  }

  const eventRefs = slate.eligible.map((g) => g.game.espnEventId);
  const existing = await findExistingRunForEvents(eventRefs);
  if (shouldBlockRerun(existing, opts.confirmRerun ?? false)) {
    return { slate, written: null, blockedByExistingRun: existing };
  }

  const { runInput } = buildNflResearchPredictionRun({ slate, eloOpts: eloBook.opts, generatedAt: now, dataAsOfUtc: now });
  if (!runInput) {
    // Structurally unreachable given the length check above (every eligible
    // game produces a prediction pair), kept as an explicit, honest branch
    // rather than a non-null assertion.
    return { slate, written: null, blockedByExistingRun: null };
  }

  const written = await createPredictionRun(runInput);
  return { slate, written, blockedByExistingRun: null };
}
