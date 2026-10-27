import { prisma } from "@/lib/prisma";
import { checkCronAuth } from "@/lib/cronAuth";
import { backfillEspnLeague, monthsBack, seedEspnLeagues, syncEspnFixtures, syncEspnTeams } from "@/lib/allSports/espn";
import { warmLogos } from "@/lib/allSports/logos";

/**
 * Free fixtures, history and crests from ESPN for every league it covers —
 * whether or not an odds feed lists it yet. The next week's fixtures first, so
 * boards fill; then for a new league
 * gets 15 months of results (this season and last) and every team's crest;
 * a known one refreshes the last two months. Then it looks up logos for the
 * week's teams and players outside ESPN. Resumable — it stops near the time
 * limit and picks up the rest on the next call.
 */
export const maxDuration = 60;

const FULL_MONTHS = 15;
const REFRESH_MONTHS = 1;
const FIXTURE_DAYS = 7;

export async function GET(request: Request) {
  return POST(request);
}

export async function POST(request: Request) {
  const authError = checkCronAuth(request);
  if (authError) return authError;
  const started = Date.now();
  const now = new Date();
  // Every league ESPN covers exists from day one, odds feed or not.
  const seeded = await seedEspnLeagues();
  const leagues = await prisma.league.findMany({ where: { active: true, espnPath: { not: null } }, orderBy: { rank: "asc" } });

  // The week's fixtures first (each league every 6 hours): they're what the boards show.
  let fixtures = 0;
  for (const l of leagues) {
    if (Date.now() - started > 25_000) break;
    const job = `espn-fixtures:${l.id}`;
    const last = await prisma.pollLog.findUnique({ where: { jobName: job } });
    if (last && now.getTime() - last.lastPolledAt.getTime() < 6 * 3_600_000) continue;
    try {
      const n = await syncEspnFixtures(l.id, l.espnPath!, FIXTURE_DAYS, now);
      fixtures += n;
      const data = { lastPolledAt: now, lastStatus: `ok: ${n} fixtures` };
      await prisma.pollLog.upsert({ where: { jobName: job }, create: { jobName: job, ...data }, update: data });
    } catch {
      // The next call retries it.
    }
  }

  const done: string[] = [];
  const failures: string[] = [];
  for (const l of leagues) {
    if (Date.now() - started > 45_000) break;
    const job = `espn-backfill:${l.id}`;
    const last = await prisma.pollLog.findUnique({ where: { jobName: job } });
    if (last && now.getTime() - last.lastPolledAt.getTime() < 20 * 3_600_000) continue;
    try {
      await syncEspnTeams(l.sport, l.espnPath!);
      const n = await backfillEspnLeague(l.id, l.espnPath!, monthsBack(now, last ? REFRESH_MONTHS : FULL_MONTHS));
      const data = { lastPolledAt: now, lastStatus: `ok: ${n} results` };
      await prisma.pollLog.upsert({ where: { jobName: job }, create: { jobName: job, ...data }, update: data });
      done.push(`${l.id} (${n})`);
    } catch (error) {
      failures.push(`${l.id}: ${error instanceof Error ? error.message.slice(0, 120) : String(error)}`);
    }
  }
  // Whatever time is left: crests and photos for the next few days' teams and players.
  const logos = await warmLogos(Math.max(0, 50_000 - (Date.now() - started))).catch(() => 0);
  return Response.json({ leagues: leagues.length, seeded, fixtures, done, failures, logosLookedUp: logos });
}
