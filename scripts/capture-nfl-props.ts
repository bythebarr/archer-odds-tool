import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { createPredictionRun } from "@/lib/predictions";
import { loadFrozenModel, NFL_PROPS_MODEL_KEY, NFL_PROPS_MODEL_VERSION, NFL_PROPS_LIFECYCLE } from "@/lib/nfl/props/frozen";
import { projectUpcomingWeek } from "@/lib/nfl/props/live";
import { buildNflPropsPredictionRun } from "@/lib/nfl/props/predictionCapture";

/**
 * Manual forward-capture of the upcoming NFL week's player-prop projections
 * (frozen model, lifecycle `experimental`) into PredictionRun/ModelPrediction.
 * See docs/architecture/NFL-PROPS-MODEL.md. Free data only (nflverse); no odds
 * provider is called. Best run Friday/Saturday, after the final injury report.
 *
 * Usage:
 *   npm run capture:nfl:props
 *   npm run capture:nfl:props -- --confirm-rerun   # record another revision for the same week
 *   npm run capture:nfl:props -- --dry-run         # project and summarize, write nothing
 */
async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const confirmRerun = args.has("--confirm-rerun");
  console.log(`NFL props capture — ${NFL_PROPS_MODEL_KEY} ${NFL_PROPS_MODEL_VERSION} (${NFL_PROPS_LIFECYCLE})`);

  const model = loadFrozenModel();
  const live = await projectUpcomingWeek(new Date());
  const run = buildNflPropsPredictionRun(live, model.file, new Date());
  console.log(`Season ${live.season} week ${live.week}: ${live.games.length} games, ${run.predictions.length} projections, ${live.excluded.length} excluded (injury report / roster status).`);
  for (const w of live.warnings) console.warn(`  warning: ${w}`);
  if (dryRun) return;

  const eventRefs = [...new Set(run.predictions.map((p) => p.eventRef))];
  const existing = await prisma.predictionRun.findFirst({
    where: { modelKey: NFL_PROPS_MODEL_KEY, modelVersion: NFL_PROPS_MODEL_VERSION, predictions: { some: { eventRef: { in: eventRefs } } } },
    orderBy: { generatedAt: "desc" },
    select: { id: true, generatedAt: true },
  });
  if (existing && !confirmRerun) {
    console.error(`A run already exists for this week (${existing.id}, ${existing.generatedAt.toISOString()}). Re-run with --confirm-rerun to record a new revision.`);
    process.exitCode = 1;
    return;
  }
  const created = await createPredictionRun(run);
  console.log(`Recorded run ${created.runId} with ${created.predictionIds.length} predictions.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
