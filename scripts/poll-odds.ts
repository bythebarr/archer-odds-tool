import "dotenv/config";
import { pollAndStoreOdds } from "@/lib/odds/ingest";

async function main() {
  console.log("Polling The Odds API for current MLB lines...");
  const summary = await pollAndStoreOdds();
  console.log(summary);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
