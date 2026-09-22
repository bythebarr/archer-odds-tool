/**
 * The only write path onto PredictionRun/ModelPrediction (see
 * docs/architecture/MODEL-PREDICTION-LIFECYCLE.md). Deliberately generic: no
 * CFB-, MLB-, NFL-, Discord-, or provider-specific imports. No sport writes
 * to this yet — this task adds the foundation only.
 *
 * Create-only, by design: there is no update/delete export here. A
 * correction is a new PredictionRun, never an edit of an old one — see
 * ModelPrediction's schema docstring for why.
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { assertValidPredictionRunInput } from "./validate";
import type { CreatedPredictionRun, PredictionRunInput } from "./types";
import type { JsonValue } from "./types";

/**
 * Cast to Prisma's own JSON input type at the storage boundary only. Safe
 * here specifically because `assertValidPredictionRunInput` has already run
 * `isJsonSerializable` over every one of these values — this is a type-level
 * bridge between our sport-agnostic `JsonValue` and Prisma's generated input
 * type, not a runtime trust decision.
 */
function toPrismaJson(value: JsonValue): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

/**
 * Validates, then writes one run and all of its predictions in a single
 * transaction: either every row is created, or none are. Predictions are
 * inserted sequentially inside the transaction (not `Promise.all`) — this
 * codebase's own interactive-transaction convention (see
 * src/lib/card/selection.ts's `setSelection`), since Prisma's driver-adapter
 * transactions hold a single connection and aren't safe to fan out
 * concurrently.
 *
 * Throws `PredictionValidationError` (see ./validate) before any write if
 * the input fails validation. Throws whatever Prisma throws (e.g. a unique-
 * constraint violation) if the transaction itself fails — this function
 * never catches/swallows a write failure.
 *
 * **Practical batch-size boundary.** Each prediction is one sequential
 * round-trip inside one interactive transaction, and Prisma's own default
 * interactive-transaction options (`maxWait: 2000ms` to acquire the
 * transaction, `timeout: 5000ms` for the whole callback to finish — verified
 * against this project's installed `@prisma/client` runtime) are untouched
 * here. That's comfortably enough for a realistic single run (a day's slate
 * — tens of predictions), but a run with many hundreds+ of predictions could
 * hit the 5s timeout and roll back entirely. No batching/chunking/explicit
 * timeout override exists yet — deliberately not built ahead of a real
 * caller with a real batch-size need (no queue infrastructure here). If a
 * future writer needs materially larger runs, that's the point to revisit
 * this, not to raise the timeout speculatively now.
 */
export async function createPredictionRun(input: PredictionRunInput): Promise<CreatedPredictionRun> {
  assertValidPredictionRunInput(input);

  return prisma.$transaction(async (tx) => {
    const run = await tx.predictionRun.create({
      data: {
        sportKey: input.sportKey,
        modelKey: input.modelKey,
        modelVersion: input.modelVersion,
        lifecycle: input.lifecycle,
        generatedAt: input.generatedAt,
        dataAsOfUtc: input.dataAsOfUtc,
        featureSchemaVersion: input.featureSchemaVersion,
        // A top-level `null` for an optional JSON field is treated the same
        // as omitting it (leaves the column SQL NULL) — this codebase has no
        // existing convention for Prisma's explicit-JSON-null sentinel
        // (`Prisma.JsonNull`), and "no snapshot was supplied" and "the
        // snapshot is JSON null" aren't meaningfully different for these
        // fields, so there's no reason to introduce that distinction here.
        ...(input.calibrationSnapshot != null ? { calibrationSnapshot: toPrismaJson(input.calibrationSnapshot) } : {}),
        ...(input.runMetadata != null ? { runMetadata: toPrismaJson(input.runMetadata) } : {}),
      },
    });

    const predictionIds: string[] = [];
    for (const p of input.predictions) {
      const row = await tx.modelPrediction.create({
        data: {
          runId: run.id,
          eventRef: p.eventRef,
          scheduledStartUtc: p.scheduledStartUtc,
          marketKey: p.marketKey,
          selectionKey: p.selectionKey,
          probability: p.probability ?? null,
          // Required, and already asserted non-null/non-undefined by
          // assertValidPredictionRunInput.
          featureSnapshot: toPrismaJson(p.featureSnapshot),
          ...(p.projection != null ? { projection: toPrismaJson(p.projection) } : {}),
          ...(p.missingInputs != null ? { missingInputs: toPrismaJson(p.missingInputs) } : {}),
          ...(p.marketSnapshot != null ? { marketSnapshot: toPrismaJson(p.marketSnapshot) } : {}),
        },
      });
      predictionIds.push(row.id);
    }

    return { runId: run.id, predictionIds };
  });
}
