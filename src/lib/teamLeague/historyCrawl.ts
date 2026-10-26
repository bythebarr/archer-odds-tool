/**
 * The player-history backfill, automated: a cursor per league (kept in PollLog
 * as `history-cursor-<sport>`, its status the next ET date to log, or "done")
 * that each tick advances a few dates — logging box scores, positions and
 * period scores exactly as the manual "Backfill player history" workflow does.
 * Idempotent, so overlapping the daily results sync costs nothing. To re-crawl
 * (say, after new columns are added), delete the PollLog row.
 */
import { prisma } from "@/lib/prisma";
import { shiftEtDate, todayEt } from "@/lib/dateEt";
import { recordPollLog } from "@/lib/pollingPolicy";
import { syncNbaGameLogs } from "@/lib/nba/gameLogs";
import { syncNbaPositions } from "@/lib/nba/positions";
import { syncNflGameLogs, syncNflPositions } from "@/lib/nfl/gameLogs";

/** Where each league's crawl starts: the opening day of last season. */
export const HISTORY_START = { nba: "2025-10-21", nfl: "2025-09-04" } as const;

const cursorJob = (sport: "nba" | "nfl") => `history-cursor-${sport}`;

export interface CrawlStep {
  sport: "nba" | "nfl";
  dates: string[];
  next: string | null;
  gamesLogged: number;
  failures: string[];
}

/** Logs the next `days` dates for a league, or nothing once the crawl reached yesterday. */
export async function crawlHistory(sport: "nba" | "nfl", days: number): Promise<CrawlStep> {
  const row = await prisma.pollLog.findUnique({ where: { jobName: cursorJob(sport) } });
  if (row?.lastStatus === "done") return { sport, dates: [], next: null, gamesLogged: 0, failures: [] };
  const from = row?.lastStatus && /^\d{4}-\d{2}-\d{2}$/.test(row.lastStatus) ? row.lastStatus : HISTORY_START[sport];

  const yesterday = shiftEtDate(todayEt(), -1);
  const dates: string[] = [];
  for (let d = from; dates.length < days && d <= yesterday; d = shiftEtDate(d, 1)) dates.push(d);
  const summary = dates.length ? await (sport === "nba" ? syncNbaGameLogs(dates) : syncNflGameLogs(dates)) : null;
  const after = dates.length ? shiftEtDate(dates[dates.length - 1], 1) : from;
  const next = after <= yesterday ? after : null;
  if (next === null) await (sport === "nba" ? syncNbaPositions() : syncNflPositions()).catch(() => undefined);
  await recordPollLog(cursorJob(sport), next ?? "done");
  return { sport, dates, next, gamesLogged: summary?.gamesLogged ?? 0, failures: summary?.failures ?? [] };
}
