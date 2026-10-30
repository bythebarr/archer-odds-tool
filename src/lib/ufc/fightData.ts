/**
 * Loads every UFC bout the fight model replays (fightModel.ts), in date order,
 * with both corners' bout stats and each fighter's physicals and record.
 * Shared by the live query and the backtest so both see identical inputs.
 */
import { prisma } from "@/lib/prisma";
import { dedupeBouts, fightSeconds, type BoutRecord, type BoutStatLine, type FighterInfo } from "./fightModel";

export interface UfcHistory {
  fighters: Map<string, FighterInfo>;
  /** Completed bouts, oldest first. */
  bouts: BoutRecord[];
}

function statLine(s: {
  significantStrikesLanded: number;
  significantStrikesAttempted: number;
  takedownsLanded: number;
  takedownsAttempted: number;
  knockdowns: number;
  submissionAttempts: number;
  controlTimeSeconds: number;
}): BoutStatLine {
  return {
    sigLanded: s.significantStrikesLanded,
    sigAttempted: s.significantStrikesAttempted,
    tdLanded: s.takedownsLanded,
    tdAttempted: s.takedownsAttempted,
    knockdowns: s.knockdowns,
    subAttempts: s.submissionAttempts,
    controlSeconds: s.controlTimeSeconds,
  };
}

export async function loadUfcHistory(): Promise<UfcHistory> {
  const [fighterRows, boutRows] = await Promise.all([
    prisma.ufcFighter.findMany({ select: { id: true, reachInches: true, recordWins: true, recordLosses: true, birthDate: true } }),
    prisma.ufcBout.findMany({
      where: { status: "completed" },
      orderBy: [{ event: { eventDate: "asc" } }, { boutOrder: "desc" }],
      select: {
        id: true,
        weightClass: true,
        redCornerFighterId: true,
        blueCornerFighterId: true,
        winnerFighterId: true,
        method: true,
        resultRound: true,
        resultTime: true,
        event: { select: { eventDate: true } },
        fighterStats: {
          select: {
            fighterId: true,
            significantStrikesLanded: true,
            significantStrikesAttempted: true,
            takedownsLanded: true,
            takedownsAttempted: true,
            knockdowns: true,
            submissionAttempts: true,
            controlTimeSeconds: true,
          },
        },
      },
    }),
  ]);
  const fighters = new Map(fighterRows.map((f) => [f.id, f]));
  const bouts: BoutRecord[] = boutRows.map((b) => {
    const red = b.fighterStats.find((s) => s.fighterId === b.redCornerFighterId);
    const blue = b.fighterStats.find((s) => s.fighterId === b.blueCornerFighterId);
    return {
      id: b.id,
      date: b.event.eventDate,
      weightClass: b.weightClass,
      red: b.redCornerFighterId,
      blue: b.blueCornerFighterId,
      winner: b.winnerFighterId,
      method: b.method,
      seconds: fightSeconds(b.resultRound, b.resultTime),
      redStats: red ? statLine(red) : null,
      blueStats: blue ? statLine(blue) : null,
    };
  });
  return { fighters, bouts: dedupeBouts(bouts, new Date()) };
}
