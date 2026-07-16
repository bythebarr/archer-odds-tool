import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { importTennisArchive } from "@/lib/tennis/archive";
import { computeAndStoreTennisRatings } from "@/lib/tennis/ratings";

/**
 * Backfill the free Jeff Sackmann ATP/WTA match archive into TennisArchiveMatch —
 * the training + backtest base for the tennis Elo model. Zero Odds API credits.
 *
 * Run: `npm run import:tennis` (default 2015–2026, ATP+WTA).
 * Override the span: `YEARS=2000-2026 npm run import:tennis`.
 * A weekly cron re-running the current year keeps ratings current (immutable-match
 * semantics = re-runs only add newly-completed matches).
 */
function parseYears(): number[] {
  const spec = process.env.YEARS ?? "2015-2026";
  const [a, b] = spec.split("-").map((s) => parseInt(s, 10));
  const start = a;
  const end = b ?? a;
  const years: number[] = [];
  for (let y = start; y <= end; y++) years.push(y);
  return years;
}

async function main() {
  const years = parseYears();
  console.log(`Importing tennis archive for ${years[0]}–${years[years.length - 1]} (ATP+WTA)…`);
  const summary = await importTennisArchive({ years });
  console.log(`\nFetched ${summary.fetched} matches, inserted ${summary.inserted} new.`);
  const nonzero = Object.entries(summary.perYear).filter(([, n]) => n > 0);
  for (const [k, n] of nonzero) console.log(`  ${k}: +${n}`);

  // Keep the ratings snapshot the board prices off of in sync with the archive.
  console.log(`\nRecomputing Elo ratings…`);
  const ratings = await computeAndStoreTennisRatings();
  console.log(`Stored ${ratings.playersRated} player ratings from ${ratings.matchesReplayed} matches.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect().finally(() => process.exit()));
