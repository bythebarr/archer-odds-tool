import { prisma } from "@/lib/prisma";
import { ingestSeasonSchedule } from "./ingestSchedule";
import { backfillF1History } from "./backfillF1";

// Read-side self-heal for the F1 page — Hobby crons fire unreliably, so the
// page keeps itself fresh: it pulls the calendar when it has no known upcoming
// race, and pulls results when a race that has already happened is still
// missing its classification. Fire-and-forget after the response, and throttled
// in-process so a burst of views triggers at most one refresh per window.
const THROTTLE_MS = 10 * 60 * 1000;
let lastRun = 0;

export function refreshF1OnView(): void {
  const now = Date.now();
  if (now - lastRun < THROTTLE_MS) return;
  lastRun = now;

  void (async () => {
    try {
      const nowDate = new Date();
      const season = nowDate.getUTCFullYear();
      const [futureCount, pastMissing] = await Promise.all([
        prisma.f1Race.count({ where: { raceDate: { gt: nowDate } } }),
        prisma.f1Race.count({ where: { raceDate: { lt: nowDate }, results: { none: {} } } }),
      ]);

      // No upcoming race on the books → pull the calendar so "next race" fills in.
      if (futureCount === 0) await ingestSeasonSchedule(season);
      // A race has run but we never ingested its results → backfill this season.
      if (pastMissing > 0) await backfillF1History(season, season);
    } catch (err) {
      console.error("[f1] refreshF1OnView failed", err);
    }
  })();
}
