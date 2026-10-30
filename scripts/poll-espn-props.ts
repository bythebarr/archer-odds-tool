import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { pollEspnProps } from "@/lib/odds/espnPropsPoll";
import { recordPollLog } from "@/lib/pollingPolicy";

/** The espn-props cron's work, run by hand (Model Lab): ESPN's prop lines into EventPropLine and the NBA/NFL tables. */
async function main() {
  const t = Date.now();
  const out = await pollEspnProps(Date.now() + 240_000);
  console.log(JSON.stringify(out, null, 1), `${((Date.now() - t) / 1000).toFixed(1)}s`);
  await recordPollLog("espn-props", `ok (manual): ${JSON.stringify(out).slice(0, 380)}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
