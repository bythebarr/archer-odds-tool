import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { computeAndStoreTennisRatings } from "@/lib/tennis/ratings";

/**
 * Rebuild the TennisRating snapshot from the archive — run after `import:tennis`.
 * Live tennis pricing reads this instead of replaying the archive per render.
 *
 * Run: `npm run ratings:tennis`.
 */
async function main() {
  console.log("Replaying the tennis archive to compute current Elo ratings…");
  const summary = await computeAndStoreTennisRatings();
  console.log(`Replayed ${summary.matchesReplayed} matches, stored ${summary.playersRated} player ratings.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
