import "dotenv/config";
import { pollAndStoreSoccerOdds } from "@/lib/soccer/ingest";

async function main() {
  console.log("Polling The Odds API for current World Cup soccer lines...");
  const summary = await pollAndStoreSoccerOdds();
  console.log(summary);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
