import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { syncMlbSchedule } from "@/lib/mlb/syncSchedule";
import { ingestGameLogsForGame } from "@/lib/props/gameLogIngest";
import { todayEt } from "@/lib/dateEt";

/** MLB Stats API isn't officially rate-limited, but this is polite and keeps a ~1350-game full-season backfill from hammering it in a tight loop. */
const DELAY_MS = 150;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Backfills PlayerGameLog for every completed MLB game in [startDate, endDate]
 * (YYYY-MM-DD, ET) — free, MLB Stats API only, no Odds API credits. Usage:
 *   tsx scripts/backfill-player-game-logs.ts [startDate] [endDate]
 * Defaults to the full 2026 season through today if no args given.
 */
async function main() {
  const startDate = process.argv[2] ?? "2026-03-01";
  const endDate = process.argv[3] ?? todayEt();

  console.log(`Syncing MLB schedule/results for ${startDate}..${endDate} (ensures Game rows exist for the backfill)...`);
  const scheduleSummary = await syncMlbSchedule(startDate, endDate);
  console.log(scheduleSummary);

  const games = await prisma.game.findMany({
    where: {
      sport: "mlb",
      status: "final",
      scheduledStartUtc: { gte: new Date(`${startDate}T00:00:00Z`), lte: new Date(`${endDate}T23:59:59Z`) },
    },
    select: { id: true, mlbGameId: true, scheduledStartUtc: true, homeTeamId: true, awayTeamId: true },
    orderBy: { scheduledStartUtc: "asc" },
  });
  console.log(`Found ${games.length} final games to ingest.`);

  let rowsWritten = 0;
  let gamesProcessed = 0;
  let gamesFailed = 0;

  for (const game of games) {
    if (!game.mlbGameId || !game.homeTeamId || !game.awayTeamId) continue; // sport:"mlb" CHECK guarantees these are set, but keep TS happy
    try {
      rowsWritten += await ingestGameLogsForGame({
        id: game.id,
        mlbGameId: game.mlbGameId,
        scheduledStartUtc: game.scheduledStartUtc,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
      });
    } catch (err) {
      gamesFailed++;
      console.error(`Failed to ingest game ${game.mlbGameId}:`, err instanceof Error ? err.message : err);
    }
    gamesProcessed++;
    if (gamesProcessed % 50 === 0) {
      console.log(`...${gamesProcessed}/${games.length} games processed, ${rowsWritten} player-game rows written so far`);
    }
    await sleep(DELAY_MS);
  }

  console.log(`Done. ${gamesProcessed} games processed, ${gamesFailed} failed, ${rowsWritten} player-game rows written.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
