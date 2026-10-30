/**
 * UFC legs for the parlay builder: each corner's moneyline on the coming
 * cards, at the best price, with ARCHR's chance from the fight model (blended
 * with the market where books price the bout) and the fighter's record over
 * his last 5, 10, 20 fights and the last twelve months.
 */
import { prisma } from "@/lib/prisma";
import { listUpcomingUfcEvents } from "@/lib/queries/ufcEvents";
import { getUfcFightModel } from "@/lib/queries/ufcFightModel";
import { getBestLinesForBouts } from "@/lib/queries/ufcOdds";
import { BOOK_NAMES } from "@/lib/odds/bookAllowlist";
import { edgeOf, ratesOf, type BuilderLeg, type Outcome } from "../types";

const LOOKAHEAD_DAYS = 8;

export async function ufcLegs(now = new Date()): Promise<BuilderLeg[]> {
  const events = (await listUpcomingUfcEvents(2)).filter((e) => e.eventDate.getTime() <= now.getTime() + LOOKAHEAD_DAYS * 86_400_000);
  const bouts = events.flatMap((e) => e.bouts.map((b) => ({ event: e, bout: b })));
  if (!bouts.length) return [];
  const lines = await getBestLinesForBouts(bouts.map((b) => b.bout.id));
  const fighterIds = bouts.flatMap((b) => [b.bout.red.id, b.bout.blue.id]);
  const past = await prisma.ufcBout.findMany({
    where: { winnerFighterId: { not: null }, OR: [{ redCornerFighterId: { in: fighterIds } }, { blueCornerFighterId: { in: fighterIds } }] },
    select: { redCornerFighterId: true, blueCornerFighterId: true, winnerFighterId: true, event: { select: { eventDate: true } } },
    orderBy: { event: { eventDate: "desc" } },
  });
  const yearAgo = now.getTime() - 365 * 86_400_000;
  const record = (fighterId: string): Outcome[] =>
    past
      .filter((b) => b.redCornerFighterId === fighterId || b.blueCornerFighterId === fighterId)
      .map((b) => ({ hit: b.winnerFighterId === fighterId, season: b.event.eventDate.getTime() >= yearAgo ? 1 : 0 }));

  const out: BuilderLeg[] = [];
  for (const { event, bout } of bouts) {
    const model = await getUfcFightModel(bout.id).catch(() => null);
    const line = lines.get(bout.id);
    for (const [corner, f, prob, best] of [
      ["red", bout.red, model ? model.probRed : null, line?.red ?? null],
      ["blue", bout.blue, model ? 1 - model.probRed : null, line?.blue ?? null],
    ] as const) {
      out.push({
        id: `ufc:${bout.id}:${corner}`,
        sport: "ufc",
        league: "UFC",
        eventId: `ufc:${bout.id}`,
        eventLabel: `${bout.red.name} vs ${bout.blue.name}`,
        startsAt: event.eventDate.toISOString(),
        href: `/ufc/${bout.id}`,
        kind: "ml",
        label: `${f.name} ML`,
        group: `ufc:${bout.id}:ml`,
        priceAmerican: best?.priceAmerican ?? null,
        bookName: best ? (BOOK_NAMES[best.bookKey] ?? best.bookKey) : null,
        archr: prob,
        edge: edgeOf(prob, best?.priceAmerican ?? null),
        rates: ratesOf(record(f.id), 1),
      });
    }
  }
  return out;
}
