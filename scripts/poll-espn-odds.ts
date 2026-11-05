import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { NBA_LEAGUE } from "@/lib/nba/league";
import { NFL_LEAGUE } from "@/lib/nfl/league";
import { pollEspnOddsTeamLeague } from "@/lib/odds/espnOddsPoll";

/** The espn-odds cron's NBA and NFL work, run by hand (Model Lab): fresh DraftKings game lines, stale feeds retired. */
async function main() {
  const t = Date.now();
  const nba = await pollEspnOddsTeamLeague(NBA_LEAGUE, 2);
  const nfl = await pollEspnOddsTeamLeague(NFL_LEAGUE, 7);
  console.log(JSON.stringify({ nba, nfl }), `${((Date.now() - t) / 1000).toFixed(1)}s`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
