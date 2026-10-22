import "dotenv/config";
import { pollAndStoreNbaOdds } from "@/lib/nba/league";

async function main() {
  console.log("Polling for current NBA lines (spreads, totals, moneyline)...");
  const summary = await pollAndStoreNbaOdds();
  console.log(summary);
}

main();
