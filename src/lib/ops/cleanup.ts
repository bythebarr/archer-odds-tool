/**
 * Daily retention: prune price history nothing reads any more, so storage and
 * query times stay flat as the seasons pile up.
 *
 * What goes:
 *  - per-poll price snapshots (game lines, MLB props, NBA props) for games that
 *    started more than RETENTION_DAYS ago. They exist for line history and
 *    closing-line capture, and grading captures the close within days of a game
 *    (GameClosingLine), so a 90-day-old snapshot has no remaining reader.
 *  - "current" NBA prop lines for games that started over two days ago; a
 *    current line on a finished game is just a dead row.
 *  - credit-log rows older than RETENTION_DAYS.
 *
 * What stays: games, closing lines, graded outcomes, game logs, posted plays,
 * every model prediction. The record and the hit-rate history are permanent.
 *
 * Deletes go a batch of games at a time through each table's gameId index, under
 * a time budget, so a run never scans a whole table or outlasts its function. A
 * backlog clears over a few days; after that each run removes one day's worth.
 */
import { prisma } from "@/lib/prisma";

export const RETENTION_DAYS = 90;
const GAMES_PER_BATCH = 50;
const TIME_BUDGET_MS = 25_000;

const SNAPSHOT_TABLES = ["OddsSnapshot", "PlayerPropSnapshot", "NbaPropSnapshot"] as const;

export interface CleanupSummary {
  cutoff: string;
  /** Rows deleted per table. */
  deleted: Record<string, number>;
  /** True when the time budget ran out with old rows left; the next run continues. */
  backlogRemaining: boolean;
}

export async function runRetentionCleanup(now: Date = new Date()): Promise<CleanupSummary> {
  const started = Date.now();
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86_400_000);
  const deleted: Record<string, number> = {};
  let backlogRemaining = false;

  for (const table of SNAPSHOT_TABLES) {
    deleted[table] = 0;
    for (;;) {
      if (Date.now() - started > TIME_BUDGET_MS) {
        backlogRemaining = true;
        break;
      }
      // Oldest games that still have rows in this table. Game is small and the
      // EXISTS is an index probe, so this stays cheap however big the table is.
      const games = await prisma.$queryRawUnsafe<{ id: string }[]>(
        `SELECT g.id FROM "Game" g
         WHERE g."scheduledStartUtc" < $1
           AND EXISTS (SELECT 1 FROM "${table}" s WHERE s."gameId" = g.id)
         ORDER BY g."scheduledStartUtc"
         LIMIT ${GAMES_PER_BATCH}`,
        cutoff
      );
      if (games.length === 0) break;
      deleted[table] += await prisma.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE "gameId" = ANY($1::text[])`,
        games.map((g) => g.id)
      );
    }
  }

  const staleNbaLines = await prisma.currentNbaPropLine.deleteMany({
    where: { game: { scheduledStartUtc: { lt: new Date(now.getTime() - 2 * 86_400_000) } } },
  });
  deleted.CurrentNbaPropLine = staleNbaLines.count;

  const creditLog = await prisma.pollCreditLog.deleteMany({ where: { polledAt: { lt: cutoff } } });
  deleted.PollCreditLog = creditLog.count;

  return { cutoff: cutoff.toISOString(), deleted, backlogRemaining };
}
