import "dotenv/config";
import { syncMlbSchedule } from "@/lib/mlb/syncSchedule";
import { todayEt, shiftEtDate } from "@/lib/dateEt";

async function main() {
  // ET, not UTC. `toISOString()` rolls over at 7-8pm ET, so running this in the
  // evening used to start the window on TOMORROW's date and skip the slate
  // that was still being played — the same boundary the sync-results cron
  // already guards with an ET lookback. Starting a day back also lets an
  // in-progress slate finish syncing.
  const today = todayEt();
  const startDate = process.argv[2] ?? shiftEtDate(today, -1);
  const endDate = process.argv[3] ?? shiftEtDate(today, 6);

  console.log(`Syncing MLB schedule ${startDate} → ${endDate}...`);
  const summary = await syncMlbSchedule(startDate, endDate);
  console.log(summary);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
