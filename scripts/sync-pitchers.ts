import "dotenv/config";
import { syncProbablePitchers } from "@/lib/mlb/syncPitchers";

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function main() {
  const startDate = process.argv[2] ?? todayPlus(0);
  const endDate = process.argv[3] ?? todayPlus(6);

  console.log(`Syncing probable pitchers ${startDate} → ${endDate}...`);
  const summary = await syncProbablePitchers(startDate, endDate);
  console.log(summary);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
