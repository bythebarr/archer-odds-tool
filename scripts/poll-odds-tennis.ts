import "dotenv/config";
import { pollAndStoreTennisOdds } from "@/lib/tennis/ingest";

async function main() {
  console.log("Polling The Odds API for current tennis lines...");
  const summary = await pollAndStoreTennisOdds();
  console.log(summary);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
