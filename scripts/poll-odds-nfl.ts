import "dotenv/config";
import { pollAndStoreNflOdds } from "@/lib/nfl/league";

async function main() {
  console.log("Polling for current NFL lines (spreads, totals, moneyline)...");
  const summary = await pollAndStoreNflOdds();
  console.log(summary);
}

main();
