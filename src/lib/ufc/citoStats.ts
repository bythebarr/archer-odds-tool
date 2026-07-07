import type { CitoStatLine } from "./citoApiClient";

/** Parses Cito's "98 of 240" landed-of-attempted strings. Missing/malformed input defaults to 0/0 rather than throwing — one bad field shouldn't drop an entire stat row. */
function parseLandedOf(value: string | null | undefined): { landed: number; attempted: number } {
  const match = value?.match(/^(\d+)\s+of\s+(\d+)$/);
  if (!match) return { landed: 0, attempted: 0 };
  return { landed: Number(match[1]), attempted: Number(match[2]) };
}

/** Parses Cito's "MM:SS" control-time strings into total seconds. */
function parseControlTime(value: string | null | undefined): number {
  const match = value?.match(/^(\d+):(\d{2})$/);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

export interface ParsedStatLine {
  knockdowns: number;
  submissionAttempts: number;
  reversals: number;
  controlTimeSeconds: number;
  significantStrikesLanded: number;
  significantStrikesAttempted: number;
  totalStrikesLanded: number;
  totalStrikesAttempted: number;
  takedownsLanded: number;
  takedownsAttempted: number;
  headStrikesLanded: number;
  headStrikesAttempted: number;
  bodyStrikesLanded: number;
  bodyStrikesAttempted: number;
  legStrikesLanded: number;
  legStrikesAttempted: number;
  distanceStrikesLanded: number;
  distanceStrikesAttempted: number;
  clinchStrikesLanded: number;
  clinchStrikesAttempted: number;
  groundStrikesLanded: number;
  groundStrikesAttempted: number;
}

/** Converts one Cito stat line (aggregate or round) into the flat landed/attempted int columns UfcBoutFighterStats/UfcBoutRoundStats store. */
export function parseStatLine(line: CitoStatLine): ParsedStatLine {
  const sig = parseLandedOf(line.significantStrikes);
  const total = parseLandedOf(line.totalStrikes);
  const td = parseLandedOf(line.takedowns);
  const head = parseLandedOf(line.head);
  const body = parseLandedOf(line.body);
  const leg = parseLandedOf(line.leg);
  const distance = parseLandedOf(line.distance);
  const clinch = parseLandedOf(line.clinch);
  const ground = parseLandedOf(line.ground);

  return {
    knockdowns: line.knockdowns ?? 0,
    submissionAttempts: line.submissionAttempts ?? 0,
    reversals: line.reversals ?? 0,
    controlTimeSeconds: parseControlTime(line.controlTime),
    significantStrikesLanded: sig.landed,
    significantStrikesAttempted: sig.attempted,
    totalStrikesLanded: total.landed,
    totalStrikesAttempted: total.attempted,
    takedownsLanded: td.landed,
    takedownsAttempted: td.attempted,
    headStrikesLanded: head.landed,
    headStrikesAttempted: head.attempted,
    bodyStrikesLanded: body.landed,
    bodyStrikesAttempted: body.attempted,
    legStrikesLanded: leg.landed,
    legStrikesAttempted: leg.attempted,
    distanceStrikesLanded: distance.landed,
    distanceStrikesAttempted: distance.attempted,
    clinchStrikesLanded: clinch.landed,
    clinchStrikesAttempted: clinch.attempted,
    groundStrikesLanded: ground.landed,
    groundStrikesAttempted: ground.attempted,
  };
}
