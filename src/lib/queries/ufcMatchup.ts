import { prisma } from "@/lib/prisma";
import type { UfcBoutFighterStats } from "@/generated/prisma/client";

export type UfcFightResult = "win" | "loss" | "draw" | "noContest";

export interface UfcFightRecord {
  boutId: string;
  eventDate: Date;
  opponentId: string;
  opponentSlug: string;
  opponentName: string;
  opponentImageUrl: string | null;
  result: UfcFightResult;
  method: string | null;
  resultRound: number | null;
  myStats: UfcBoutFighterStats | null;
  opponentStats: UfcBoutFighterStats | null;
}

export interface UfcFighterHistory {
  fighterId: string;
  fighterSlug: string;
  fighterName: string;
  fights: UfcFightRecord[]; // most recent first
}

export interface CrossBout {
  fighterOneId: string;
  fighterTwoId: string;
  winnerFighterId: string | null;
  method: string | null;
  eventDate: Date;
}

export interface UfcMatchup {
  fighterA: UfcFighterHistory;
  fighterB: UfcFighterHistory;
  /** Bouts directly between one of A's opponents and one of B's opponents — the raw material for commonOpponents.ts's 2-hop chain detection. Fetched here (not inside the pure compute layer) so fighterMath.ts stays a pure function over pre-fetched data, matching archer/winProbability.ts's split from queries/matchup.ts. */
  crossBouts: CrossBout[];
}

/**
 * A completed bout with no winnerFighterId is a draw or no-contest — Cito
 * doesn't distinguish the two in a dedicated field, only via the raw
 * `method` string, so this infers from that (falls back to "draw" as the
 * neutral default; ~1.7% of bouts in our backfilled data hit this path).
 */
function inferResult(winnerFighterId: string | null, fighterId: string, method: string | null): UfcFightResult {
  if (winnerFighterId === fighterId) return "win";
  if (winnerFighterId !== null) return "loss";
  if (method?.toLowerCase().includes("no contest") || method?.toLowerCase().includes("nc")) return "noContest";
  return "draw";
}

/**
 * Full completed-bout history for one fighter, most recent first — the
 * shared building block for all three fighterMath layers (strength,
 * common-opponent, style). Includes both fighters' UfcBoutFighterStats rows
 * per bout (nullable — not every bout has been enriched by Cito), since the
 * style layer's defense proxies need the *opponent's* stats row too (e.g. a
 * fighter's takedown defense is derived from what opponents landed against
 * them, not from the fighter's own row).
 */
export async function getUfcFightHistory(fighterId: string): Promise<UfcFighterHistory | null> {
  const fighter = await prisma.ufcFighter.findUnique({ where: { id: fighterId } });
  if (!fighter) return null;

  const bouts = await prisma.ufcBout.findMany({
    where: {
      status: "completed",
      // Cito ships a duplicate of some real bouts under an event whose
      // eventDate is off by +1yr (see schema caveat on UfcEvent.eventDate) —
      // always with hasStats=false. Without this guard that future-dated dup
      // sorts to the top of the history (wrong date + wrong opponent) and
      // double-counts into the fighter-math projections. Matches the same
      // filter listRecentUfcEvents/mapEventSummary rely on in ufcEvents.ts.
      event: { hasStats: true },
      OR: [{ redCornerFighterId: fighterId }, { blueCornerFighterId: fighterId }],
    },
    include: {
      event: true,
      redCornerFighter: true,
      blueCornerFighter: true,
      fighterStats: true,
    },
    orderBy: { event: { eventDate: "desc" } },
  });

  const fights: UfcFightRecord[] = bouts.map((bout) => {
    const isRed = bout.redCornerFighterId === fighterId;
    const opponent = isRed ? bout.blueCornerFighter : bout.redCornerFighter;
    const myStats = bout.fighterStats.find((s) => s.fighterId === fighterId) ?? null;
    const opponentStats = bout.fighterStats.find((s) => s.fighterId === opponent.id) ?? null;

    return {
      boutId: bout.id,
      eventDate: bout.event.eventDate,
      opponentId: opponent.id,
      opponentSlug: opponent.citoSlug,
      opponentName: opponent.fullName,
      opponentImageUrl: opponent.imageUrl,
      result: inferResult(bout.winnerFighterId, fighterId, bout.method),
      method: bout.method,
      resultRound: bout.resultRound,
      myStats,
      opponentStats,
    };
  });

  return { fighterId: fighter.id, fighterSlug: fighter.citoSlug, fighterName: fighter.fullName, fights };
}

/**
 * Every completed bout directly between someone in `groupOne` and someone
 * in `groupTwo` — feeds the common-opponent layer's 2-hop chain detection
 * (see commonOpponents.ts): given A's opponents and B's opponents as the
 * two groups, this finds the links connecting them ("X, who A fought,
 * also fought Z, who B fought") without pulling full fight histories for
 * every tangential fighter.
 */
export async function getCrossBouts(groupOne: string[], groupTwo: string[]): Promise<CrossBout[]> {
  if (groupOne.length === 0 || groupTwo.length === 0) return [];

  const bouts = await prisma.ufcBout.findMany({
    where: {
      status: "completed",
      // Same +1yr mis-dated-duplicate guard as getUfcFightHistory above —
      // keeps the common-opponent chain math off the corrupt dup rows.
      event: { hasStats: true },
      OR: [
        { redCornerFighterId: { in: groupOne }, blueCornerFighterId: { in: groupTwo } },
        { redCornerFighterId: { in: groupTwo }, blueCornerFighterId: { in: groupOne } },
      ],
    },
    include: { event: { select: { eventDate: true } } },
  });

  return bouts.map((bout) => ({
    fighterOneId: bout.redCornerFighterId,
    fighterTwoId: bout.blueCornerFighterId,
    winnerFighterId: bout.winnerFighterId,
    method: bout.method,
    eventDate: bout.event.eventDate,
  }));
}

async function buildMatchup(fighterA: UfcFighterHistory, fighterB: UfcFighterHistory): Promise<UfcMatchup> {
  const crossBouts = await getCrossBouts(
    fighterA.fights.map((f) => f.opponentId),
    fighterB.fights.map((f) => f.opponentId)
  );
  return { fighterA, fighterB, crossBouts };
}

/**
 * Matchup for an existing UfcBout row (typically an upcoming/scheduled
 * fight already ingested). NOTE: the current backfill (see backfillUfc.ts)
 * only sweeps Cito's /events/recent listing, which covers past events —
 * genuinely upcoming cards (e.g. next weekend's fight) aren't in the DB yet
 * until a separate /events/upcoming ingestion pass is added. Use
 * getUfcMatchupByFighterSlugs below for a hypothetical/upcoming pairing
 * that has no UfcBout row yet.
 */
export async function getUfcMatchup(boutId: string): Promise<UfcMatchup | null> {
  const bout = await prisma.ufcBout.findUnique({ where: { id: boutId } });
  if (!bout) return null;

  const [fighterA, fighterB] = await Promise.all([
    getUfcFightHistory(bout.redCornerFighterId),
    getUfcFightHistory(bout.blueCornerFighterId),
  ]);
  if (!fighterA || !fighterB) return null;

  return buildMatchup(fighterA, fighterB);
}

/** Same as getUfcMatchup, but by fighter identity directly — works for a hypothetical or announced-but-not-yet-ingested pairing. */
export async function getUfcMatchupByFighterSlugs(
  fighterASlug: string,
  fighterBSlug: string
): Promise<UfcMatchup | null> {
  const [a, b] = await Promise.all([
    prisma.ufcFighter.findUnique({ where: { citoSlug: fighterASlug } }),
    prisma.ufcFighter.findUnique({ where: { citoSlug: fighterBSlug } }),
  ]);
  if (!a || !b) return null;

  const [fighterA, fighterB] = await Promise.all([getUfcFightHistory(a.id), getUfcFightHistory(b.id)]);
  if (!fighterA || !fighterB) return null;

  return buildMatchup(fighterA, fighterB);
}
