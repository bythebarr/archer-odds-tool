import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { fightSeconds } from "@/lib/ufc/fightModel";

/**
 * One-time cleanup: merge UFC fights stored twice into one row.
 *
 * Copies come from the Cito feed listing a card twice (a generic "UFC Fight
 * Night" a day after the named event, or dated a year late) and from the
 * UFCStats archive adding its own bout beside Cito's. A copy is the rule the
 * read path uses (fightModel.ts dedupeFights): the same pair of fighters within
 * 3 days, or the same pair, winner and stoppage time on any date.
 *
 * For each fight it keeps one bout (a correctly dated one first, then Cito's
 * own row so the daily sync keeps updating it, then the one with stats), moves
 * onto it whatever only the copy has (stats, round stats, odds, the UFCStats
 * id, the result), repoints prediction history, then deletes the copy, one
 * transaction per fight. Events left with no bouts are deleted too.
 *
 * Dry run by default: prints what it would do. `APPLY=1` makes the changes.
 * Run: `npm run fix:ufc-duplicates` (dry) or `npm run fix:ufc-duplicates:apply`.
 */
const SAME_FIGHT_MS = 3 * 86_400_000;
const APPLY = process.env.APPLY === "1";

async function main() {
  const now = Date.now();
  const rows = await prisma.ufcBout.findMany({
    where: { status: "completed" },
    orderBy: [{ event: { eventDate: "asc" } }, { boutOrder: "desc" }],
    select: {
      id: true,
      citoBoutId: true,
      ufcStatsId: true,
      eventId: true,
      redCornerFighterId: true,
      blueCornerFighterId: true,
      winnerFighterId: true,
      method: true,
      methodDetails: true,
      resultRound: true,
      resultTime: true,
      event: { select: { eventDate: true, title: true } },
      _count: { select: { fighterStats: true } },
    },
  });
  type Row = (typeof rows)[number];

  // Cluster the copies with the read path's rule.
  const clusters: Row[][] = [];
  const lastByPair = new Map<string, number>();
  const byFinish = new Map<string, number>();
  for (const b of rows) {
    const pair = [b.redCornerFighterId, b.blueCornerFighterId].sort().join("|");
    const seconds = fightSeconds(b.resultRound, b.resultTime);
    const finish = b.winnerFighterId && seconds && seconds % 300 !== 0 ? `${pair}|${b.winnerFighterId}|${seconds}` : null;
    const near = lastByPair.get(pair);
    const same = finish !== null ? byFinish.get(finish) : undefined;
    const into =
      near !== undefined && b.event.eventDate.getTime() - clusters[near][clusters[near].length - 1].event.eventDate.getTime() <= SAME_FIGHT_MS ? near : same;
    if (into !== undefined) {
      clusters[into].push(b);
      continue;
    }
    lastByPair.set(pair, clusters.length);
    if (finish) byFinish.set(finish, clusters.length);
    clusters.push([b]);
  }
  const dupes = clusters.filter((c) => c.length > 1);

  const rank = (b: Row) => [
    b.event.eventDate.getTime() <= now ? 0 : 1, // correctly dated first
    b.citoBoutId.startsWith("ufcstats:") ? 1 : 0, // Cito's own row, so the daily sync keeps updating it
    b._count.fighterStats >= 2 ? 0 : 1, // with stats
    b.event.eventDate.getTime(),
  ];
  const better = (a: Row, b: Row) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i];
    return false;
  };

  console.log(`${rows.length} completed bouts; ${dupes.length} fights stored more than once (${dupes.reduce((a, c) => a + c.length - 1, 0)} extra rows).`);
  const byYear = new Map<number, number>();
  for (const c of dupes) byYear.set(c[0].event.eventDate.getUTCFullYear(), (byYear.get(c[0].event.eventDate.getUTCFullYear()) ?? 0) + c.length - 1);
  console.log(`Extra rows by year:`, [...byYear].sort((a, b) => a[0] - b[0]).map(([y, n]) => `${y}: ${n}`).join(", "));
  for (const c of dupes.slice(0, 8)) {
    const keep = c.reduce((k, b) => (better(b, k) ? b : k));
    console.log(
      `  keep ${keep.event.eventDate.toISOString().slice(0, 10)} "${keep.event.title}" [${keep.citoBoutId.slice(0, 18)}] · drop ` +
        c.filter((b) => b !== keep).map((b) => `${b.event.eventDate.toISOString().slice(0, 10)} "${b.event.title}" [${b.citoBoutId.slice(0, 18)}]`).join(", ")
    );
  }

  const touchedEvents = new Set<string>();
  const totals = { merged: 0, statsMoved: 0, roundsMoved: 0, oddsMoved: 0, predictionsRepointed: 0, boutsDeleted: 0, eventsDeleted: 0 };
  for (const c of dupes) {
    const keep = c.reduce((k, b) => (better(b, k) ? b : k));
    const drops = c.filter((b) => b !== keep);
    for (const d of drops) touchedEvents.add(d.eventId);
    if (!APPLY) continue;
    await prisma.$transaction(async (tx) => {
      for (const d of drops) {
        // Stats the keeper lacks.
        const haveStats = new Set((await tx.ufcBoutFighterStats.findMany({ where: { boutId: keep.id }, select: { fighterId: true } })).map((s) => s.fighterId));
        const moveStats = await tx.ufcBoutFighterStats.updateMany({ where: { boutId: d.id, fighterId: { notIn: [...haveStats] } }, data: { boutId: keep.id } });
        totals.statsMoved += moveStats.count;
        const haveRounds = new Set((await tx.ufcBoutRoundStats.findMany({ where: { boutId: keep.id }, select: { fighterId: true, round: true } })).map((s) => `${s.fighterId}|${s.round}`));
        for (const r of await tx.ufcBoutRoundStats.findMany({ where: { boutId: d.id }, select: { id: true, fighterId: true, round: true } })) {
          if (haveRounds.has(`${r.fighterId}|${r.round}`)) continue;
          await tx.ufcBoutRoundStats.update({ where: { id: r.id }, data: { boutId: keep.id } });
          totals.roundsMoved++;
        }
        // Odds the keeper lacks, by book and corner.
        const haveOdds = new Set((await tx.ufcBoutOdds.findMany({ where: { boutId: keep.id }, select: { bookKey: true, corner: true } })).map((o) => `${o.bookKey}|${o.corner}`));
        for (const o of await tx.ufcBoutOdds.findMany({ where: { boutId: d.id }, select: { id: true, bookKey: true, corner: true } })) {
          if (haveOdds.has(`${o.bookKey}|${o.corner}`)) continue;
          await tx.ufcBoutOdds.update({ where: { id: o.id }, data: { boutId: keep.id } });
          totals.oddsMoved++;
        }
        // Prediction history: point at the keeper unless it already has the same prediction.
        totals.predictionsRepointed += await tx.$executeRaw`
          UPDATE "ModelPrediction" p SET "eventRef" = ${keep.id}
          WHERE p."eventRef" = ${d.id} AND NOT EXISTS (
            SELECT 1 FROM "ModelPrediction" q WHERE q."runId" = p."runId" AND q."eventRef" = ${keep.id}
              AND q."marketKey" = p."marketKey" AND q."selectionKey" = p."selectionKey")`;
        // The UFCStats id and result, when only the copy has them.
        const fresh = await tx.ufcBout.findUniqueOrThrow({ where: { id: keep.id }, select: { ufcStatsId: true, winnerFighterId: true, method: true, resultRound: true, resultTime: true, statsFetchedAt: true } });
        if (!fresh.ufcStatsId && d.ufcStatsId) await tx.ufcBout.update({ where: { id: d.id }, data: { ufcStatsId: null } });
        await tx.ufcBout.update({
          where: { id: keep.id },
          data: {
            ...(!fresh.ufcStatsId && d.ufcStatsId ? { ufcStatsId: d.ufcStatsId } : {}),
            ...(!fresh.winnerFighterId && d.winnerFighterId ? { winnerFighterId: d.winnerFighterId } : {}),
            ...(!fresh.method && d.method ? { method: d.method, methodDetails: d.methodDetails } : {}),
            ...(!fresh.resultRound && d.resultRound ? { resultRound: d.resultRound, resultTime: d.resultTime } : {}),
            ...(!fresh.statsFetchedAt && moveStats.count > 0 ? { statsFetchedAt: new Date() } : {}),
          },
        });
        await tx.ufcBoutFighterStats.deleteMany({ where: { boutId: d.id } });
        await tx.ufcBoutRoundStats.deleteMany({ where: { boutId: d.id } });
        await tx.ufcBoutOdds.deleteMany({ where: { boutId: d.id } });
        await tx.ufcBout.delete({ where: { id: d.id } });
        totals.boutsDeleted++;
      }
    });
    totals.merged++;
  }

  // Events the merge emptied.
  const empty = await prisma.ufcEvent.findMany({ where: { id: { in: [...touchedEvents] }, bouts: { none: {} } }, select: { id: true, title: true, eventDate: true } });
  console.log(`${touchedEvents.size} events held a dropped copy; ${APPLY ? "" : "after the merge, "}events left empty: ${APPLY ? empty.length : "(counted on apply)"}`);
  if (APPLY && empty.length) totals.eventsDeleted = (await prisma.ufcEvent.deleteMany({ where: { id: { in: empty.map((e) => e.id) } } })).count;

  console.log(APPLY ? `Applied: ${JSON.stringify(totals)}` : `Dry run: nothing changed. Run with APPLY=1 to merge ${dupes.length} fights.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
