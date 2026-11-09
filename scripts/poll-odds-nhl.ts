import "dotenv/config";
import { pollAndStoreNhlOdds } from "@/lib/nhl/league";

async function main() {
  console.log("Polling for current NHL lines (puck line, totals, moneyline)...");
  const summary = await pollAndStoreNhlOdds();
  console.log(summary);
}

main();
